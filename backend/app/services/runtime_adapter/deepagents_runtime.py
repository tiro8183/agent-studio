import json
from pathlib import Path
from typing import Any

from deepagents import create_deep_agent
from deepagents.middleware.subagents import SubAgent
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from sqlmodel import Session

from app.core.schemas import AgentRuntimeManifestRead
from app.core.models import Agent, LLMConfig
from app.config import settings
from app.services.mappers import _dumps
from app.services.runtime_adapter.backend_select import (
    backend_from_plan,
    permissions_from_config_dict,
    permissions_from_plan,
)
from app.services.runtime_adapter.compiled_plan import CompiledRuntimePlan, compile_runtime_plan
from app.services.runtime_adapter.harness_policy import (
    apply_harness_tool_descriptions,
    harness_disable_general_purpose,
    harness_middleware,
)
from app.services.runtime_adapter.model_init import build_chat_model_from_contract, probe_chat_model
from app.services.runtime_adapter.skill_source import skill_source_paths_from_plan
from app.services.runtime_adapter.state_store import close_runtime_state, get_checkpointer, get_store
from app.services.runtime_adapter.tool_load import runtime_tool_loader, tool_snapshots_from_plan
from app.services.tool_registry import ToolInvocationContext


def to_graph_messages(messages: list[dict[str, str]]) -> list[BaseMessage]:
    graph_messages: list[BaseMessage] = []
    for item in messages:
        role = item.get("role")
        content = item.get("content") or ""
        if role == "system":
            graph_messages.append(SystemMessage(content=content))
        elif role == "user":
            graph_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            graph_messages.append(AIMessage(content=content))
    return graph_messages


def collect_runtime_message_events(
    messages: list[BaseMessage],
    seen: set[str],
    *,
    sanitize_value,
    preview_text,
    event_factory,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    subagent_calls: dict[str, dict[str, str]] = {}
    for message in messages:
        if isinstance(message, AIMessage):
            for call in getattr(message, "tool_calls", []) or []:
                call_id = str(call.get("id") or f"{call.get('name')}:{len(seen)}")
                tool_name = str(call.get("name") or "tool")
                event_type = "subagent" if tool_name == "task" else "tool_called"
                label = "调用子代理" if tool_name == "task" else f"调用工具 {tool_name}"
                args = sanitize_value(call.get("args", {}))
                if event_type == "subagent" and isinstance(args, dict):
                    subagent_calls[call_id] = {
                        "subagent": str(args.get("name") or args.get("agent") or ""),
                        "task": str(args.get("task") or args.get("description") or "")[:1200],
                    }
                event_key = f"tool_called:{call_id}"
                if event_key in seen:
                    continue
                seen.add(event_key)
                event = event_factory(
                    event_type,
                    label,
                    resource=tool_name,
                    tool=tool_name,
                    call_id=call_id,
                    input=args,
                    input_preview=preview_text(args),
                )
                if event_type == "subagent" and call_id in subagent_calls:
                    event["subagent"] = subagent_calls[call_id]["subagent"]
                    event["task"] = subagent_calls[call_id]["task"]
                events.append(event)
        elif isinstance(message, ToolMessage):
            call_id = str(message.tool_call_id)
            event_key = f"tool_result:{call_id}"
            if event_key in seen:
                continue
            seen.add(event_key)
            tool_name = str(message.name or "tool")
            status = str(getattr(message, "status", "success") or "success")
            content = sanitize_value(message.content)
            subagent_info = subagent_calls.get(call_id)
            event_type = "subagent_result" if subagent_info else "tool_result"
            event = event_factory(
                event_type,
                f"协作角色完成 {subagent_info.get('subagent') or tool_name}" if subagent_info else f"工具完成 {tool_name}",
                resource=subagent_info.get("subagent") if subagent_info else tool_name,
                tool=tool_name,
                call_id=call_id,
                output=content,
                output_preview=preview_text(content),
                status=status,
            )
            if subagent_info:
                event["subagent"] = subagent_info.get("subagent") or ""
                event["task"] = subagent_info.get("task") or ""
            events.append(event)
    return events


def _release_runtime_root(agent: Agent, release_id: str) -> Path:
    root = settings.runtime_dir / "agents" / agent.id / "releases" / release_id
    (root / "workspace").mkdir(parents=True, exist_ok=True)
    return root


def _subagent_prompt(system_prompt: str, memory: list[str]) -> str:
    if not memory:
        return system_prompt
    memory_block = "\n".join(f"- {item}" for item in memory if item)
    if not memory_block:
        return system_prompt
    return f"{system_prompt}\n\n## Memory\n{memory_block}"


def _response_format_dict(output: dict[str, Any]) -> dict[str, Any] | None:
    if output.get("mode") != "json_schema":
        return None
    schema = output.get("json_schema") or {}
    return schema if isinstance(schema, dict) and schema.get("type") == "object" else None


def _response_format_from_plan(plan: CompiledRuntimePlan) -> dict[str, Any] | None:
    return _response_format_dict(dict(plan.output or {}))


def _harness_from_plan(plan: CompiledRuntimePlan) -> dict[str, Any]:
    return dict(plan.harness or {})


def _subagent_configs_from_plan(plan: CompiledRuntimePlan) -> list[dict[str, Any]]:
    return [dict(subagent) for subagent in plan.subagents if subagent.get("name")]


def _model_contract_from_plan(
    plan: CompiledRuntimePlan,
    *,
    scope: str,
    subagent: str = "",
) -> dict[str, Any] | None:
    for item in plan.model_contracts:
        if str(item.get("scope") or "main") != scope:
            continue
        if scope == "subagent" and str(item.get("subagent") or "") != subagent:
            continue
        return item
    return None


def _live_api_key_for_contract(
    contract: dict[str, Any],
    *,
    session: Session | None,
    org_id: str,
) -> str:
    if session is None:
        return ""
    llm_config_id = str(contract.get("llm_config_id") or "")
    if not llm_config_id:
        return ""
    live_llm = session.get(LLMConfig, llm_config_id)
    if not live_llm or live_llm.org_id != org_id or live_llm.status != "active":
        return ""
    return live_llm.api_key


def _chat_model_from_plan_contract(
    plan: CompiledRuntimePlan,
    *,
    session: Session | None,
    org_id: str,
    scope: str,
    subagent: str = "",
):
    contract = _model_contract_from_plan(plan, scope=scope, subagent=subagent)
    if not contract:
        return None
    if not contract.get("llm_config_id") or not contract.get("model") or not contract.get("provider_type"):
        return None
    api_key = _live_api_key_for_contract(contract, session=session, org_id=org_id)
    return build_chat_model_from_contract(contract, api_key=api_key)


async def build_deep_agent_from_spec(
    runtime_spec: dict[str, Any],
    session: Session | None = None,
    release_id: str = "",
    actor_role: str = "owner",
    tool_invocation_context: ToolInvocationContext | None = None,
    runtime_manifest: AgentRuntimeManifestRead | None = None,
    compiled_plan: CompiledRuntimePlan | None = None,
):
    agent = _agent_from_spec(runtime_spec)
    root = _release_runtime_root(agent, release_id or "preview")
    plan = compiled_plan or (compile_runtime_plan(runtime_manifest) if runtime_manifest else None)
    if plan is None:
        raise ValueError("DeepAgents adapter 需要 RuntimeManifest 或 CompiledRuntimePlan 作为唯一编译输入")
    skill_sources, subagent_skill_sources = skill_source_paths_from_plan(plan, root)
    runtime_key = release_id or agent.id
    return await _build_deep_agent(
        agent=agent,
        session=session,
        root=root,
        skill_sources=skill_sources,
        subagent_skill_sources=subagent_skill_sources,
        compiled_plan=plan,
        tool_snapshots=tool_snapshots_from_plan(plan),
        runtime_state_key=runtime_key,
        checkpointer_key=runtime_key,
        actor_role=actor_role,
        tool_invocation_context=tool_invocation_context,
    )


async def _build_deep_agent(
    *,
    agent: Agent,
    session: Session | None,
    root: Path,
    skill_sources: list[str],
    subagent_skill_sources: dict[str, list[str]],
    compiled_plan: CompiledRuntimePlan | None,
    tool_snapshots: list[dict[str, Any]] | None,
    runtime_state_key: str,
    checkpointer_key: str,
    actor_role: str,
    tool_invocation_context: ToolInvocationContext | None,
):
    if compiled_plan is None:
        raise ValueError("DeepAgents adapter 缺少 CompiledRuntimePlan")
    harness = _harness_from_plan(compiled_plan)
    needs_filesystem = bool(skill_sources or any(subagent_skill_sources.values()))
    store = await get_store(runtime_state_key)
    backend = await backend_from_plan(
        compiled_plan,
        root,
        needs_filesystem=needs_filesystem,
        skill_sources=skill_sources,
        subagent_skill_sources=subagent_skill_sources,
        store=store,
        runtime_state_key=runtime_state_key,
    )

    load_runtime_tools = runtime_tool_loader(
        agent=agent,
        session=session,
        actor_role=actor_role,
        tool_snapshots=tool_snapshots,
        tool_invocation_context=tool_invocation_context,
    )

    async def build_subagent(subagent_config: dict[str, Any]) -> SubAgent:
        subagent_name = str(subagent_config.get("name") or "")
        model = _chat_model_from_plan_contract(
            compiled_plan,
            session=session,
            org_id=agent.org_id,
            scope="subagent",
            subagent=subagent_name,
        )
        if (subagent_config.get("llm_config_id") or subagent_config.get("model")) and model is None:
            raise ValueError(f"子代理 {subagent_name or 'unnamed'} 的 LLM 运行合约不可用")
        subagent_tool_ids = compiled_plan.subagent_tool_ids.get(subagent_name, [])
        subagent_tools = await load_runtime_tools(subagent_tool_ids)
        system_prompt = str(subagent_config.get("system_prompt") or "")
        memory = list(subagent_config.get("memory") or [])
        permissions = dict(subagent_config.get("permissions") or {})
        output = dict(subagent_config.get("output") or {})
        interrupt_on = dict(subagent_config.get("interrupt_on") or {})
        spec: SubAgent = {
            "name": subagent_name,
            "description": str(subagent_config.get("description") or ""),
            "system_prompt": _subagent_prompt(system_prompt, memory),
            "tools": apply_harness_tool_descriptions(subagent_tools, harness),
            "skills": subagent_skill_sources.get(subagent_name, []),
            "permissions": permissions_from_config_dict(permissions),
            "middleware": harness_middleware(harness),
        }
        if model:
            spec["model"] = model
        if interrupt_on:
            spec["interrupt_on"] = interrupt_on
        response_format = _response_format_dict(output)
        if response_format:
            spec["response_format"] = response_format
        return spec

    subagents: list[SubAgent] = []
    for subagent in _subagent_configs_from_plan(compiled_plan):
        if subagent.get("name") and subagent.get("system_prompt"):
            subagents.append(await build_subagent(subagent))
    if harness_disable_general_purpose(harness) and not any(
        subagent.get("name") == "general-purpose" for subagent in subagents
    ):
        subagents.append(
            {
                "name": "general-purpose",
                "description": "Agent Studio 运行策略已禁用默认通用子代理。",
                "system_prompt": "平台策略已禁用默认通用子代理。",
                "tools": [],
                "middleware": harness_middleware(harness),
            }
        )
    runtime_tool_ids = compiled_plan.main_tool_ids
    runtime_tools = await load_runtime_tools(runtime_tool_ids)
    runtime_middleware = harness_middleware(harness)
    checkpointer = await get_checkpointer(checkpointer_key) if compiled_plan.checkpointing else None
    main_model = _chat_model_from_plan_contract(
        compiled_plan,
        session=session,
        org_id=agent.org_id,
        scope="main",
    )
    if main_model is None:
        raise ValueError("主 Agent 的 LLM 运行合约不可用")
    return create_deep_agent(
        model=main_model,
        tools=apply_harness_tool_descriptions(runtime_tools, harness),
        subagents=subagents,
        skills=skill_sources if compiled_plan.main_skills else [],
        memory=compiled_plan.memory,
        permissions=permissions_from_plan(compiled_plan),
        backend=backend,
        interrupt_on=compiled_plan.interrupt_on or None,
        response_format=_response_format_from_plan(compiled_plan),
        checkpointer=checkpointer,
        store=store,
        system_prompt=compiled_plan.system_prompt,
        middleware=runtime_middleware,
        debug=compiled_plan.debug,
        name=compiled_plan.agent_name,
    )


def _agent_from_spec(runtime_spec: dict[str, Any]) -> Agent:
    spec = runtime_spec.get("agent") or {}
    return Agent(
        id=str(spec.get("id") or ""),
        org_id=str(spec.get("org_id") or "org_default"),
        name=str(spec.get("name") or "Agent"),
        description=str(spec.get("description") or ""),
        system_prompt=str(spec.get("system_prompt") or ""),
        llm_config_id=str(spec.get("llm_config_id") or ""),
        model=str(spec.get("model") or ""),
        engine_mode="deepagents",
        tools_json=_dumps(spec.get("tools") or []),
        skills_json=_dumps(spec.get("skills") or []),
        subagents_json=_dumps(spec.get("subagents") or []),
        memory_json=_dumps(spec.get("memory") or []),
        filesystem_json=_dumps(spec.get("filesystem") or {}),
        permissions_json=_dumps(spec.get("permissions") or {}),
        runtime_json=_dumps(spec.get("runtime") or {}),
        output_json=_dumps(spec.get("output") or {}),
        harness_json=_dumps(spec.get("harness") or {}),
        model_override_json=_dumps(spec.get("model_override") or {}),
        routing_json=_dumps(spec.get("routing") or {}),
        context_config_json=_dumps(spec.get("context_config") or {}),
        max_iterations=int(spec.get("max_iterations") or 8),
        status=str(spec.get("status") or "published"),
        version=int(spec.get("version") or 1),
        published_at=spec.get("published_at"),
        created_at=str(spec.get("created_at") or ""),
        updated_at=str(spec.get("updated_at") or ""),
    )


def message_content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(part for part in parts if part) or json.dumps(content, ensure_ascii=False)
    return str(content)


def final_ai_text(messages: list[BaseMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, AIMessage):
            return message_content_to_text(message.content)
    return ""
