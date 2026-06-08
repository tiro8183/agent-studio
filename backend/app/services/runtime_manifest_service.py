from sqlmodel import Session

from app.core.models import Agent
from app.core.schemas import (
    AgentRead,
    AgentRuntimeManifestEnvelopeRead,
    AgentRuntimeManifestRead,
    FilesystemConfig,
    HarnessConfig,
    OutputConfig,
    PermissionConfig,
    RuntimeConfig,
    RuntimeKnowledgeManifest,
    RuntimeModelContract,
    RuntimeResourceRead,
    RuntimeSubAgentManifest,
)
from app.services.metadata_security import metadata_for_snapshot
from app.services.mappers import _loads
from app.services.runtime_capabilities import tool_ids_for_runtime
from app.services.runtime_manifest_hash import hash_runtime_manifest
from app.services.tool_registry import DEFAULT_TOOL_REQUIRED_ROLE


def build_runtime_manifest(agent: Agent, session: Session) -> AgentRuntimeManifestRead:
    from app.services.runtime_snapshot_service import build_runtime_spec

    return build_runtime_manifest_from_spec(build_runtime_spec(agent, session))


def build_runtime_manifest_envelope(
    *,
    source: str,
    manifest: AgentRuntimeManifestRead,
    release_id: str | None = None,
    manifest_hash: str | None = None,
) -> AgentRuntimeManifestEnvelopeRead:
    return AgentRuntimeManifestEnvelopeRead(
        source=source,
        manifest=manifest,
        manifest_hash=manifest_hash or hash_runtime_manifest(manifest),
        release_id=release_id,
    )


def build_runtime_manifest_from_spec(runtime_spec: dict) -> AgentRuntimeManifestRead:
    agent_read = AgentRead(**runtime_spec.get("agent", {}))
    llm_contracts = _llm_contract_map(runtime_spec.get("llm_configs", []))
    skill_map = _skill_map_from_snapshots(runtime_spec.get("skills", []))
    skill_allowed_tools = _skill_allowed_tools(skill_map)
    main_tool_ids = tool_ids_for_runtime(agent_read.tools, agent_read.skills, skill_allowed_tools)
    subagent_tool_ids = {
        subagent.name: tool_ids_for_runtime(subagent.tools, subagent.skills, skill_allowed_tools)
        for subagent in agent_read.subagents
        if subagent.name
    }
    tool_map = _tool_map_from_snapshots(runtime_spec.get("tools", []))
    missing_tools = _missing_tool_ids(main_tool_ids, tool_map)
    missing_skills = _missing_skill_ids(agent_read.skills, skill_map)
    inactive_tools = _inactive_resource_ids(main_tool_ids, tool_map)
    inactive_skills = _inactive_resource_ids(agent_read.skills, skill_map)
    model_contracts: list[RuntimeModelContract] = [
        _model_contract(
            scope="main",
            subagent="",
            llm_config_id=agent_read.llm_config_id,
            model=agent_read.model,
            agent_read=agent_read,
            llm_contracts=llm_contracts,
        )
    ]
    subagents = []
    for subagent in agent_read.subagents:
        subagent_model = subagent.model or agent_read.model
        subagent_llm_config_id = subagent.llm_config_id or agent_read.llm_config_id
        runtime_tool_ids = subagent_tool_ids.get(subagent.name, tool_ids_for_runtime(subagent.tools, subagent.skills, skill_allowed_tools))
        missing_tools.extend(_missing_tool_ids(runtime_tool_ids, tool_map))
        missing_skills.extend(_missing_skill_ids(subagent.skills, skill_map))
        inactive_tools.extend(_inactive_resource_ids(runtime_tool_ids, tool_map))
        inactive_skills.extend(_inactive_resource_ids(subagent.skills, skill_map))
        model_contracts.append(
            _model_contract(
                scope="subagent",
                subagent=subagent.name,
                llm_config_id=subagent_llm_config_id,
                model=subagent_model,
                agent_read=agent_read,
                llm_contracts=llm_contracts,
            )
        )
        subagents.append(
            RuntimeSubAgentManifest(
                name=subagent.name,
                description=subagent.description,
                system_prompt=subagent.system_prompt,
                model=subagent_model,
                llm_config_id=subagent_llm_config_id,
                tools=_resources_for_ids(runtime_tool_ids, tool_map),
                skills=_resources_for_ids(subagent.skills, skill_map),
                memory=subagent.memory,
                interrupt_on=subagent.interrupt_on,
                permissions=subagent.permissions or agent_read.permissions,
                output=subagent.output,
            )
        )

    warnings = _warnings(
        runtime=agent_read.runtime,
        filesystem=agent_read.filesystem,
        permissions=agent_read.permissions,
        output=agent_read.output,
        skill_count=len(agent_read.skills) + sum(len(subagent.skills) for subagent in agent_read.subagents),
        missing_tools=missing_tools,
        missing_skills=missing_skills,
        inactive_tools=inactive_tools,
        inactive_skills=inactive_skills,
    )
    return AgentRuntimeManifestRead(
        agent_id=agent_read.id,
        agent_name=agent_read.name,
        system_prompt=agent_read.system_prompt,
        model=agent_read.model,
        llm_config_id=agent_read.llm_config_id,
        backend_type=agent_read.runtime.backend_type,
        checkpointing=agent_read.runtime.checkpointing,
        debug=agent_read.runtime.debug,
        main_tools=_resources_for_ids(main_tool_ids, tool_map),
        main_skills=_resources_for_ids(agent_read.skills, skill_map),
        subagents=subagents,
        model_contracts=model_contracts,
        memory=agent_read.memory,
        interrupt_on=agent_read.runtime.interrupt_on,
        permissions=agent_read.permissions,
        filesystem=agent_read.filesystem,
        output=agent_read.output,
        harness=agent_read.harness,
        knowledge=_knowledge_manifest(runtime_spec.get("knowledge") or []),
        missing_tools=sorted(set(missing_tools)),
        missing_skills=sorted(set(missing_skills)),
        inactive_tools=sorted(set(inactive_tools)),
        inactive_skills=sorted(set(inactive_skills)),
        warnings=warnings,
    )


def _llm_contract_map(items: list[dict]) -> dict[str, dict]:
    return {
        str(item.get("id")): item
        for item in items
        if item.get("id")
    }


def _model_contract(
    *,
    scope: str,
    subagent: str,
    llm_config_id: str,
    model: str,
    agent_read: AgentRead,
    llm_contracts: dict[str, dict],
) -> RuntimeModelContract:
    provider = llm_contracts.get(str(llm_config_id or "")) or {}
    overrides = agent_read.model_override
    return RuntimeModelContract(
        scope=scope,
        subagent=subagent if scope == "subagent" else "",
        llm_config_id=str(llm_config_id or ""),
        provider_type=str(provider.get("provider_type") or ""),
        base_url=provider.get("base_url") or None,
        model=str(model or ""),
        default_headers=metadata_for_snapshot(provider.get("extra_headers") or {}),
        temperature=(
            overrides.temperature
            if overrides.temperature is not None
            else provider.get("temperature")
        ),
        max_tokens=(
            overrides.max_tokens
            if overrides.max_tokens is not None
            else provider.get("max_tokens")
        ),
        top_p=overrides.top_p,
        api_key_ref=str(provider.get("api_key_ref") or llm_config_id or ""),
        status=str(provider.get("status") or ""),
    )


def _tool_map_from_snapshots(tools: list[dict]) -> dict[str, RuntimeResourceRead]:
    return {
        str(item.get("id")): RuntimeResourceRead(
            id=str(item.get("id")),
            name=str(item.get("name") or ""),
            status=str(item.get("status") or ""),
            kind=str(item.get("implementation") or ""),
            metadata={
                "category": item.get("category") or "",
                "required_role": _snapshot_required_role(item),
                "snapshot": item,
            },
        )
        for item in tools
        if item.get("id")
    }


def _skill_map_from_snapshots(skills: list[dict]) -> dict[str, RuntimeResourceRead]:
    return {
        str(item.get("id")): RuntimeResourceRead(
            id=str(item.get("id")),
            name=str(item.get("display_name") or item.get("name") or ""),
            status=str(item.get("status") or ""),
            kind="skill",
            metadata={
                "slug": item.get("name") or "",
                "version": item.get("version") or 1,
                "allowed_tools": item.get("allowed_tools") or [],
                "snapshot": item,
            },
        )
        for item in skills
        if item.get("id")
    }


def _snapshot_required_role(item: dict) -> str:
    metadata = item.get("metadata") or {}
    if not isinstance(metadata, dict):
        return DEFAULT_TOOL_REQUIRED_ROLE
    role = str(metadata.get("required_role") or DEFAULT_TOOL_REQUIRED_ROLE).strip().lower()
    return role if role in {"viewer", "editor", "admin", "owner"} else DEFAULT_TOOL_REQUIRED_ROLE


def _resources_for_ids(ids: list[str], resources: dict[str, RuntimeResourceRead]) -> list[RuntimeResourceRead]:
    return [resources[item] for item in ids if item in resources]


def _skill_allowed_tools(resources: dict[str, RuntimeResourceRead]) -> dict[str, list[str]]:
    return {
        skill_id: [
            str(tool_id)
            for tool_id in resource.metadata.get("allowed_tools", [])
            if tool_id
        ]
        for skill_id, resource in resources.items()
        if resource.status == "active"
    }


def _knowledge_manifest(items: list[dict]) -> list[RuntimeKnowledgeManifest]:
    return [
        RuntimeKnowledgeManifest(
            id=str(item.get("id") or ""),
            file_name=str(item.get("file_name") or ""),
            content_type=str(item.get("content_type") or ""),
            size=int(item.get("size") or 0),
            snapshot_size=int(item.get("snapshot_size") or 0),
            char_count=int(item.get("char_count") or 0),
            content_hash=str(item.get("content_hash") or ""),
            chunk_count=int(item.get("chunk_count") or len(item.get("chunks") or []) or 0),
            chunk_source=str(item.get("chunk_source") or ""),
        )
        for item in items
        if item.get("id")
    ]


def _missing_tool_ids(ids: list[str], resources: dict[str, RuntimeResourceRead]) -> list[str]:
    return [item for item in ids if item and item not in resources]


def _missing_skill_ids(ids: list[str], resources: dict[str, RuntimeResourceRead]) -> list[str]:
    return [item for item in ids if item and item not in resources]


def _inactive_resource_ids(ids: list[str], resources: dict[str, RuntimeResourceRead]) -> list[str]:
    return [
        item
        for item in ids
        if item in resources and resources[item].status != "active"
    ]


def _warnings(
    runtime: RuntimeConfig,
    filesystem: FilesystemConfig,
    permissions: PermissionConfig,
    output: OutputConfig,
    skill_count: int,
    missing_tools: list[str],
    missing_skills: list[str],
    inactive_tools: list[str],
    inactive_skills: list[str],
) -> list[str]:
    warnings: list[str] = []
    if missing_tools:
        warnings.append("存在未注册的 Tool，Runtime 会跳过这些 Tool。")
    if missing_skills:
        warnings.append("存在未注册的 Skill，Runtime 不会加载这些 Skill。")
    if inactive_tools:
        warnings.append("存在未启用的 Tool，需要启用或解绑。")
    if inactive_skills:
        warnings.append("存在未启用的 Skill，需要启用或解绑。")
    if runtime.backend_type == "state" and (skill_count > 0 or not filesystem.enabled):
        warnings.append("内存状态不适合依赖服务工作区或 Skill source 的 Agent。")
    if runtime.checkpointing and runtime.backend_type == "state":
        warnings.append("开启检查点时建议使用服务工作区或状态库，以获得更完整的持久化行为。")
    if output.mode == "json_schema" and not output.json_schema:
        warnings.append("已选择结构化输出，但未配置结构化格式约束。")
    if permissions.allow_write and not permissions.allowed_paths:
        warnings.append("允许写入但没有限制访问范围，建议明确服务工作区边界。")
    return warnings
