import json
import re
from collections.abc import AsyncGenerator
from pathlib import Path
from time import perf_counter
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from app.core.models import Agent, AgentRun, Conversation, KnowledgeDocument, LLMConfig, Message, Upload, new_id, now_iso
from app.core.schemas import AgentInvocationRequest, CanonicalMessage
from app.services.agent_preflight_service import RUN_REQUIRED_CHECK_KEYS, build_agent_preflight
from app.services.audit_service import record_audit
from app.services.knowledge_retrieval_service import (
    KnowledgeSource,
    RetrievalResult,
    content_hash,
    retrieve_knowledge_context,
    retrieve_knowledge_context_from_chunks,
    retrieve_knowledge_context_from_snapshot,
)
from app.services.knowledge_chunk_service import list_agent_chunks, records_to_chunks
from app.services.knowledge_retrieval_audit_service import record_knowledge_retrieval_audit
from app.services.llm_invocation_log_service import record_llm_invocation_logs_from_messages
from app.services.llm_observability_service import LLMUsageSummary, summarize_llm_usage, summarize_llm_usage_breakdown
from app.services.run_trace_service import trace_event
from app.services.run_governance_service import RunCancelledError, ensure_run_not_cancelled
from app.services.run_event_service import write_run_events
from app.services.runtime_adapter import RuntimeManifestMismatch, assert_manifest_alignment, compile_runtime_plan
from app.services.runtime_adapter.deepagents_runtime import (
    build_deep_agent_from_spec,
    collect_runtime_message_events,
    final_ai_text,
    to_graph_messages,
)
from app.services.runtime_governance_gate import RuntimeGovernanceBlocked, assert_runtime_governance
from app.services.runtime_plan_service import RuntimePlan, build_runtime_plan
from app.services.tool_registry import ToolInvocationContext


SENSITIVE_TRACE_KEYS = {"api_key", "authorization", "password", "secret", "token", "value"}
TRACE_TEXT_LIMIT = 1200
TRACE_LIST_LIMIT = 20


class AgentExecutionService:
    def __init__(
        self,
        session: Session,
        org_id: str = "org_default",
        actor_role: str = "owner",
        actor_user_id: str | None = None,
    ):
        self.session = session
        self.org_id = org_id
        self.actor_role = actor_role
        self.actor_user_id = actor_user_id

    def _ensure_conversation(self, agent: Agent, payload: AgentInvocationRequest) -> Conversation:
        user_message = self._request_user_message(payload)
        if payload.conversation_id:
            conversation = self.session.get(Conversation, payload.conversation_id)
            if not conversation or conversation.org_id != self.org_id or conversation.agent_id != agent.id:
                raise ValueError("会话不存在或不属于当前服务")
            return conversation

        conversation = Conversation(
            id=new_id("conv"),
            org_id=self.org_id,
            agent_id=agent.id,
            title=user_message[:48] or "新会话",
        )
        self.session.add(conversation)
        self.session.commit()
        self.session.refresh(conversation)
        return conversation

    def _execution_context_id(self, agent: Agent, payload: AgentInvocationRequest) -> str:
        if payload.persist_messages:
            return self._ensure_conversation(agent, payload).id
        if payload.execution_context_id:
            return payload.execution_context_id
        return payload.conversation_id or new_id("runctx")

    def _fixed_reply(self, runtime_context: RuntimePlan, message: str) -> Optional[str]:
        routing = runtime_context.agent_spec.get("routing") or {"fixed_replies": []}
        message_lower = message.lower()
        for rule in routing.get("fixed_replies", []):
            for keyword in rule.get("keywords", []):
                if keyword and keyword.lower() in message_lower:
                    return rule.get("reply") or ""
        return None

    def _request_messages(self, payload: AgentInvocationRequest) -> list[CanonicalMessage]:
        if payload.messages:
            return payload.messages
        return [CanonicalMessage(role="user", content=payload.message)]

    def _request_user_message(self, payload: AgentInvocationRequest) -> str:
        for item in reversed(self._request_messages(payload)):
            if item.role == "user":
                return item.content
        return payload.message

    def _canonical_context_messages(self, payload: AgentInvocationRequest, user_content: str) -> list[dict[str, str]]:
        source = self._request_messages(payload)
        if not source:
            return [{"role": "user", "content": user_content}]
        converted: list[dict[str, str]] = []
        replaced_last_user = False
        for index, item in enumerate(source):
            role = "system" if item.role == "developer" else item.role
            is_last_user = item.role == "user" and not any(next_item.role == "user" for next_item in source[index + 1 :])
            converted.append({"role": role, "content": user_content if is_last_user else item.content})
            replaced_last_user = replaced_last_user or is_last_user
        if not replaced_last_user:
            converted.append({"role": "user", "content": user_content})
        return converted

    def _runtime_context(self, agent: Agent, preview: bool) -> RuntimePlan | None:
        return build_runtime_plan(agent, self.session, self.org_id, preview)

    def _runtime_gate_error(self, agent: Agent, runtime_context: RuntimePlan, preview: bool) -> str:
        if preview:
            preflight = build_agent_preflight(agent, self.session)
            if preflight.can_run:
                return ""
            blockers = [
                f"{item.label}: {item.detail}"
                for item in preflight.checks
                if item.key in RUN_REQUIRED_CHECK_KEYS and item.severity == "blocker" and not item.passed
            ]
            summary = "；".join(blockers[:3]) or "当前配置未通过运行检查"
            return f"当前配置验证未通过运行检查：{summary}"

        manifest = runtime_context.runtime_manifest
        resource_issues = [
            *[f"缺失工具 {item}" for item in manifest.missing_tools],
            *[f"缺失能力 {item}" for item in manifest.missing_skills],
            *[f"未启用工具 {item}" for item in manifest.inactive_tools],
            *[f"未启用 Skill {item}" for item in manifest.inactive_skills],
        ]
        if resource_issues:
            return f"上线版本运行依赖不可用：{'；'.join(resource_issues[:5])}"
        if manifest.warnings:
            return f"上线版本运行清单存在阻断风险：{'；'.join(manifest.warnings[:5])}"
        return ""

    def _recent_messages(self, conversation_id: str, max_rounds: int) -> List[Dict[str, str]]:
        limit = max_rounds * 2
        stmt = (
            select(Message)
            .where(Message.conversation_id == conversation_id, Message.org_id == self.org_id)
            .order_by(Message.created_at.desc())
            .limit(limit)
        )
        rows = list(reversed(self.session.exec(stmt).all()))
        return [{"role": row.role, "content": row.content} for row in rows]

    def _append_message(self, conversation_id: str, role: str, content: str) -> None:
        self.session.add(Message(org_id=self.org_id, conversation_id=conversation_id, role=role, content=content))
        conversation = self.session.get(Conversation, conversation_id)
        if conversation:
            conversation.updated_at = now_iso()
            self.session.add(conversation)
        self.session.commit()

    def _attachment_context(self, attachment_ids: List[str], conversation_id: str) -> str:
        if not attachment_ids:
            return ""

        chunks: List[str] = []
        for upload_id in attachment_ids:
            upload = self.session.get(Upload, upload_id)
            if not upload or upload.org_id != self.org_id:
                continue
            if upload.conversation_id and upload.conversation_id != conversation_id:
                continue
            if not upload.conversation_id:
                upload.conversation_id = conversation_id
                self.session.add(upload)
                self.session.commit()
            path = Path(upload.file_path)
            if not path.exists() or upload.size > 1024 * 1024:
                chunks.append(f"=== 附件: {upload.file_name} ===\n[文件不存在或超过 1MB，未读取]")
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                text = "[文件读取失败]"
            chunks.append(f"=== 附件: {upload.file_name} ===\n{text[:20000]}")
        return "\n\n".join(chunks)

    def _knowledge_retrieval(self, runtime_context: RuntimePlan, query: str) -> RetrievalResult:
        if runtime_context.source in {"release", "snapshot"}:
            return retrieve_knowledge_context_from_snapshot(runtime_context.runtime_spec.get("knowledge") or [], query)
        persisted_chunks = records_to_chunks(list_agent_chunks(self.session, self.org_id, runtime_context.agent_id))
        if persisted_chunks:
            return retrieve_knowledge_context_from_chunks(persisted_chunks, query)
        stmt = (
            select(KnowledgeDocument)
            .where(KnowledgeDocument.agent_id == runtime_context.agent_id)
            .where(KnowledgeDocument.org_id == self.org_id)
            .order_by(KnowledgeDocument.created_at.desc())
        )
        sources: list[KnowledgeSource] = []
        for document in self.session.exec(stmt).all():
            path = Path(document.file_path)
            if not path.exists() or document.size > 1024 * 1024:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            sources.append(
                KnowledgeSource(
                    id=document.id,
                    file_name=document.file_name,
                    content_text=text,
                    content_hash=content_hash(text),
                    content_type=document.content_type,
                    created_at=document.created_at,
                )
            )
        return retrieve_knowledge_context(sources, query)

    def _compose_user_content(
        self,
        runtime_context: RuntimePlan,
        message: str,
        attachment_ids: List[str],
        conversation_id: str | None = None,
    ) -> tuple[str, RetrievalResult]:
        sections: List[str] = []
        knowledge_result = self._knowledge_retrieval(runtime_context, message)
        knowledge_context = knowledge_result.context
        attachment_context = self._attachment_context(attachment_ids, conversation_id) if conversation_id else ""
        if knowledge_context:
            sections.append(f"以下是当前服务绑定的知识库内容，请优先参考：\n\n{knowledge_context}")
        if attachment_context:
            sections.append(f"用户上传了以下附件：\n\n{attachment_context}")
        if not sections:
            return message, knowledge_result
        context = "\n\n".join(sections)
        return f"{context}\n\n用户问题：{message}", knowledge_result

    def _knowledge_trace_event(self, result: RetrievalResult, started: float) -> dict[str, Any] | None:
        if not result.audit.get("indexed_chunks"):
            return None
        return trace_event(
            "knowledge_retrieval",
            f"召回 {result.audit.get('retrieved_chunks', 0)} 个知识片段",
            started,
            resource="knowledge",
            output=result.audit,
            output_preview=json.dumps(result.audit.get("sources", [])[:3], ensure_ascii=False)[:240],
        )

    def _collect_runtime_events(
        self,
        messages: list[Any],
        seen: set[str],
        started: float,
    ) -> List[Dict[str, Any]]:
        return collect_runtime_message_events(
            messages,
            seen,
            sanitize_value=self._sanitize_trace_value,
            preview_text=self._event_preview,
            event_factory=lambda event_type, label, **extra: trace_event(event_type, label, started, **extra),
        )

    def _sanitize_trace_value(self, value: Any) -> Any:
        if isinstance(value, dict):
            sanitized: Dict[str, Any] = {}
            for key, item in value.items():
                key_text = str(key)
                lowered = key_text.lower()
                if lowered in SENSITIVE_TRACE_KEYS or "secret" in lowered:
                    sanitized[key_text] = "***"
                    continue
                sanitized[key_text] = self._sanitize_trace_value(item)
            return sanitized
        if isinstance(value, list):
            return [self._sanitize_trace_value(item) for item in value[:TRACE_LIST_LIMIT]]
        if isinstance(value, str):
            return self._redact_trace_text(value[:TRACE_TEXT_LIMIT])
        return value

    def _event_preview(self, content: Any) -> str:
        text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
        return self._redact_trace_text(text[:240])

    def _redact_trace_text(self, value: str) -> str:
        redacted = value
        for key in ("password", "token", "api_key", "secret", "authorization"):
            redacted = re.sub(
                rf"(?i)(['\"]?{key}['\"]?\s*[:=]\s*['\"])([^'\"]+)(['\"])",
                r"\1***\3",
                redacted,
            )
            redacted = re.sub(
                rf"(?i)(\b{key}\b\s*[:=]\s*)([^,\s}}]+)",
                r"\1***",
                redacted,
            )
        return redacted

    async def stream_events(self, agent_id: str, payload: AgentInvocationRequest) -> AsyncGenerator[dict[str, Any], None]:
        agent = self.session.get(Agent, agent_id)
        runtime_plan_override = payload.runtime_plan_override
        if not agent or agent.org_id != self.org_id or (not payload.preview and not runtime_plan_override and agent.status != "published"):
            yield {"type": "error", "message": "服务不存在或未上线", "conversation_id": None}
            return
        runtime_context = runtime_plan_override or self._runtime_context(agent, payload.preview)
        if not runtime_context:
            yield {"type": "error", "message": "服务尚未生成上线版本，请重新上线后再运行", "conversation_id": None}
            return
        gate_error = self._runtime_gate_error(agent, runtime_context, payload.preview)
        if gate_error:
            yield {"type": "error", "message": gate_error, "conversation_id": None}
            return
        llm = self._llm_for_runtime(runtime_context)
        if not llm:
            yield {"type": "error", "message": "LLM 配置不存在或未启用", "conversation_id": None}
            return

        try:
            conversation_id = self._execution_context_id(agent, payload)
        except ValueError as exc:
            yield {"type": "error", "message": str(exc), "conversation_id": None}
            return
        yield {"type": "meta", "conversation_id": conversation_id, "agent_id": agent.id}

        user_message = self._request_user_message(payload)
        fixed_reply = self._fixed_reply(runtime_context, user_message)
        if fixed_reply is not None:
            try:
                compiled_plan = self._assert_execution_ready(runtime_context)
            except RuntimeManifestMismatch as exc:
                run = self._record_blocked_run(
                    runtime_context=runtime_context,
                    conversation_id=conversation_id,
                    input_text=user_message,
                    entrypoint=payload.entrypoint,
                    run_source=payload.run_source,
                    rerun_of_run_id=payload.rerun_of_run_id,
                    trace_label=payload.trace_label,
                    reason="runtime_manifest_mismatch",
                    label="运行清单一致性校验失败",
                    error=str(exc),
                    metadata={
                        "expected_hash": exc.expected_hash,
                        "actual_hash": exc.actual_hash,
                    },
                )
                yield {"type": "error", "message": f"运行被阻断: {exc}", "conversation_id": conversation_id, "run_id": run.id}
                return
            except RuntimeGovernanceBlocked as exc:
                issues = self._governance_issue_payloads(exc)
                run = self._record_blocked_run(
                    runtime_context=runtime_context,
                    conversation_id=conversation_id,
                    input_text=user_message,
                    entrypoint=payload.entrypoint,
                    run_source=payload.run_source,
                    rerun_of_run_id=payload.rerun_of_run_id,
                    trace_label=payload.trace_label,
                    reason="runtime_governance_gate",
                    label="运行治理门阻断",
                    error=str(exc),
                    metadata={"issues": issues},
                )
                yield {"type": "error", "message": f"运行被阻断: {exc}", "conversation_id": conversation_id, "run_id": run.id}
                return
            if payload.persist_messages:
                self._append_message(conversation_id, "user", user_message)
                self._append_message(conversation_id, "assistant", fixed_reply)
            run = self._record_instant_run(
                runtime_context=runtime_context,
                conversation_id=conversation_id,
                input_text=user_message,
                output_text=fixed_reply,
                status="completed",
                entrypoint=payload.entrypoint,
                run_source=payload.run_source,
                rerun_of_run_id=payload.rerun_of_run_id,
                trace_label=payload.trace_label,
                done_label=payload.done_label,
                compiled_plan=compiled_plan,
            )
            yield {"type": "meta", "conversation_id": conversation_id, "agent_id": agent.id, "run_id": run.id}
            yield {"type": "output_delta", "content": fixed_reply, "conversation_id": conversation_id}
            yield {"type": "completed", "conversation_id": conversation_id, "run_id": run.id}
            return

        context_config = runtime_context.agent_spec.get("context_config") or {"max_rounds": 20}
        request_messages = self._request_messages(payload)
        stored_context = (
            self._recent_messages(conversation_id, int(context_config.get("max_rounds", 20)))
            if payload.persist_messages and len(request_messages) <= 1
            else []
        )
        messages = [
            {"role": "system", "content": runtime_context.runtime_manifest.system_prompt},
            *stored_context,
        ]
        if payload.persist_messages:
            self._append_message(conversation_id, "user", user_message)

        user_content, knowledge_result = self._compose_user_content(
            runtime_context,
            user_message,
            payload.attachment_ids,
            conversation_id,
        )
        messages.extend(self._canonical_context_messages(payload, user_content))

        async for event in self._run_deep_agent(
            runtime_context,
            llm,
            messages,
            conversation_id,
            user_message,
            knowledge_result,
            entrypoint=payload.entrypoint,
            run_source=payload.run_source,
            trace_label=payload.trace_label,
            done_label=payload.done_label,
            error_label=payload.error_label,
            rerun_of_run_id=payload.rerun_of_run_id,
            persist_messages=payload.persist_messages,
        ):
            yield event

    def _runtime_spec_json(self, runtime_context: RuntimePlan) -> str:
        return runtime_context.runtime_spec_json

    def _runtime_tools_json(self, runtime_context: RuntimePlan) -> str:
        return runtime_context.tools_json

    def _runtime_subagents_json(self, runtime_context: RuntimePlan) -> str:
        return runtime_context.subagents_json

    def _runtime_source(self, runtime_context: RuntimePlan) -> str:
        return runtime_context.source

    def _runtime_resource_events(self, runtime_context: RuntimePlan, started: float) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        agent_spec = runtime_context.agent_spec
        skills = list(agent_spec.get("skills") or [])
        memory = list(agent_spec.get("memory") or [])
        if skills:
            events.append(trace_event("skills", f"加载 {len(skills)} 个能力", started, resource="skills"))
        if memory:
            events.append(trace_event("memory", f"注入 {len(memory)} 条长期记忆", started, resource="memory"))
        knowledge_items = list(runtime_context.runtime_manifest.knowledge)
        if knowledge_items:
            events.append(
                trace_event("knowledge", f"注入 {len(knowledge_items)} 份业务资料", started, resource="knowledge")
            )
        llm_contracts = runtime_context.llm_usage_contracts()
        if llm_contracts:
            mixed = runtime_context.has_mixed_llm_usage
            events.append(
                trace_event(
                    "llm_contracts",
                    f"冻结 {len(llm_contracts)} 个 LLM 运行合约",
                    started,
                    resource="llm",
                    metadata={
                        "contracts": llm_contracts,
                        "mixed_runtime": mixed,
                    },
                    output={
                        "contracts": llm_contracts,
                        "mixed_runtime": mixed,
                    },
                    output_preview=" / ".join(
                        f"{item.get('subagent') or 'main'}:{item.get('model')}"
                        for item in llm_contracts
                    )[:240],
                )
            )
        return events

    def _apply_observability(
        self,
        run: AgentRun,
        usage: LLMUsageSummary,
        first_token_ms: int = 0,
    ) -> AgentRun:
        run.input_tokens = usage.input_tokens
        run.output_tokens = usage.output_tokens
        run.total_tokens = usage.total_tokens
        run.llm_calls = usage.llm_calls
        run.first_token_ms = max(first_token_ms, 0)

    def _llm_usage_trace_event(
        self,
        usage: LLMUsageSummary,
        started: float,
        messages: list[Any],
    ) -> dict[str, Any] | None:
        if usage.llm_calls <= 0 and usage.total_tokens <= 0:
            return None
        breakdown = [item.to_dict() for item in summarize_llm_usage_breakdown(messages)]
        return trace_event(
            "llm_usage",
            f"LLM 调用 {usage.llm_calls} 次，Token {usage.total_tokens}",
            started,
            resource="llm",
            metadata={"breakdown": breakdown},
            output={
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "total_tokens": usage.total_tokens,
                "llm_calls": usage.llm_calls,
                "breakdown": breakdown,
            },
            output_preview=f"{usage.input_tokens}/{usage.output_tokens}/{usage.total_tokens}",
            status="success",
        )

    def _record_knowledge_audit(
        self,
        runtime_context: RuntimePlan,
        *,
        run_id: str,
        conversation_id: str,
        source: str,
        knowledge_result: RetrievalResult,
    ) -> None:
        record_knowledge_retrieval_audit(
            self.session,
            org_id=self.org_id,
            agent_id=runtime_context.agent_id,
            run_id=run_id,
            conversation_id=conversation_id,
            source=source,
            result=knowledge_result,
        )

    def _record_llm_log(
        self,
        *,
        runtime_context: RuntimePlan,
        run: AgentRun,
        llm: LLMConfig,
        source: str,
        status: str,
        usage: LLMUsageSummary | None = None,
        messages: list[Any] | None = None,
        first_token_ms: int = 0,
        error: str = "",
    ) -> None:
        record_llm_invocation_logs_from_messages(
            self.session,
            run=run,
            runtime_context=runtime_context,
            llm=llm,
            source=source,
            status=status,
            usage=usage,
            messages=messages,
            duration_ms=run.duration_ms,
            first_token_ms=first_token_ms,
            error=error,
        )

    def _llm_for_runtime(self, runtime_context: RuntimePlan) -> LLMConfig | None:
        if runtime_context.source in {"release", "snapshot"}:
            live_llm = self.session.get(LLMConfig, runtime_context.llm_config_id)
            if not live_llm or live_llm.org_id != self.org_id or live_llm.status != "active":
                return None
            return runtime_context.llm_config_from_contract(api_key=live_llm.api_key)
        llm = self.session.get(LLMConfig, runtime_context.llm_config_id)
        if not llm or llm.org_id != self.org_id or llm.status != "active":
            return None
        return llm

    def _assert_execution_ready(self, runtime_context: RuntimePlan):
        compiled_plan = compile_runtime_plan(runtime_context.runtime_manifest)
        assert_manifest_alignment(
            runtime_context.runtime_manifest,
            runtime_context.manifest_hash,
            compiled_plan,
        )
        assert_runtime_governance(
            manifest=runtime_context.runtime_manifest,
            session=self.session,
            org_id=self.org_id,
        )
        return compiled_plan

    def _governance_issue_payloads(self, exc: RuntimeGovernanceBlocked) -> list[dict[str, Any]]:
        return [
            {
                "key": item.key,
                "resource_type": item.resource_type,
                "resource_id": item.resource_id,
                "message": item.message,
                "evidence": self._sanitize_trace_value(item.evidence),
            }
            for item in exc.issues
        ]

    def _record_blocked_run(
        self,
        *,
        runtime_context: RuntimePlan,
        conversation_id: str,
        input_text: str,
        entrypoint: str,
        run_source: str,
        rerun_of_run_id: str | None,
        trace_label: str,
        reason: str,
        label: str,
        error: str,
        metadata: dict[str, Any],
    ) -> AgentRun:
        timestamp = now_iso()
        started = perf_counter()
        run = AgentRun(
            id=new_id("run"),
            org_id=self.org_id,
            agent_id=runtime_context.agent_id,
            conversation_id=conversation_id,
            rerun_of_run_id=rerun_of_run_id,
            release_id=runtime_context.release_id,
            agent_version=runtime_context.agent_version,
            spec_hash=runtime_context.spec_hash,
            runtime_source=self._runtime_source(runtime_context),
            entrypoint=entrypoint,
            run_source=run_source,
            status="blocked",
            model=runtime_context.model,
            tools_json=self._runtime_tools_json(runtime_context),
            subagents_json=self._runtime_subagents_json(runtime_context),
            runtime_spec_json=self._runtime_spec_json(runtime_context),
            runtime_manifest_json=runtime_context.runtime_manifest_json,
            knowledge_count=runtime_context.knowledge_count,
            input_preview=input_text[:240],
            input_text=input_text[:20000],
            error=error[:500],
            duration_ms=1,
            started_at=timestamp,
            ended_at=timestamp,
        )
        write_run_events(self.session, run, [
            trace_event("run_started", trace_label, started, resource=runtime_context.agent_id),
            trace_event(
                "run_blocked",
                label,
                started,
                elapsed_ms=run.duration_ms,
                status="error",
                metadata=metadata,
                output_preview=run.error,
            ),
        ])
        self.session.add(run)
        record_audit(
            self.session,
            action="agent_run.blocked",
            status="blocked",
            org_id=self.org_id,
            user_id=self.actor_user_id,
            resource_type="agent_run",
            resource_id=run.id,
            metadata={
                "agent_id": runtime_context.agent_id,
                "reason": reason,
                **metadata,
            },
        )
        self.session.commit()
        self.session.refresh(run)
        return run

    def _record_instant_run(
        self,
        runtime_context: RuntimePlan,
        conversation_id: str,
        input_text: str,
        output_text: str = "",
        status: str = "completed",
        error: str = "",
        events: Optional[List[Dict[str, str]]] = None,
        entrypoint: str = "responses",
        run_source: str = "runtime",
        rerun_of_run_id: str | None = None,
        trace_label: str = "执行引擎启动",
        done_label: str = "运行完成",
        compiled_plan: Any = None,
    ) -> None:
        timestamp = now_iso()
        started = perf_counter()
        run = AgentRun(
            id=new_id("run"),
            org_id=self.org_id,
            agent_id=runtime_context.agent_id,
            conversation_id=conversation_id,
            rerun_of_run_id=rerun_of_run_id,
            release_id=runtime_context.release_id,
            agent_version=runtime_context.agent_version,
            spec_hash=runtime_context.spec_hash,
            runtime_source=self._runtime_source(runtime_context),
            entrypoint=entrypoint,
            run_source=run_source,
            status=status,
            model=runtime_context.model,
            tools_json=self._runtime_tools_json(runtime_context),
            subagents_json=self._runtime_subagents_json(runtime_context),
            runtime_spec_json=self._runtime_spec_json(runtime_context),
            runtime_manifest_json=runtime_context.runtime_manifest_json,
            knowledge_count=runtime_context.knowledge_count,
            input_preview=input_text[:240],
            input_text=input_text[:20000],
            output_preview=output_text[:240],
            output_text=output_text[:20000],
            error=error[:500],
            duration_ms=1,
            started_at=timestamp,
            ended_at=timestamp,
        )
        run_events = events or [
            trace_event("run_started", trace_label, started, resource=runtime_context.agent_id),
            trace_event(
                "model_invoked",
                runtime_context.model,
                started,
                resource=runtime_context.model,
                metadata={
                    "manifest_hash": runtime_context.manifest_hash,
                    "compiled_tools": len(compiled_plan.main_tools) if compiled_plan else len(runtime_context.runtime_manifest.main_tools),
                },
            ),
            trace_event("fixed_reply", "命中固定回复", started, output_preview=output_text[:240]),
            trace_event("run_completed", done_label, started, elapsed_ms=run.duration_ms),
        ]
        write_run_events(self.session, run, run_events)
        self.session.add(run)
        self.session.commit()
        self.session.refresh(run)
        return run

    async def _run_deep_agent(
        self,
        runtime_context: RuntimePlan,
        llm: LLMConfig,
        messages: List[Dict[str, str]],
        conversation_id: str,
        input_text: str,
        knowledge_result: RetrievalResult,
        entrypoint: str = "responses",
        run_source: str = "runtime",
        trace_label: str = "执行引擎启动",
        done_label: str = "运行完成",
        error_label: str = "运行失败",
        rerun_of_run_id: str | None = None,
        persist_messages: bool = True,
    ) -> AsyncGenerator[dict[str, Any], None]:
        run = AgentRun(
            id=new_id("run"),
            org_id=self.org_id,
            agent_id=runtime_context.agent_id,
            conversation_id=conversation_id,
            rerun_of_run_id=rerun_of_run_id,
            release_id=runtime_context.release_id,
            agent_version=runtime_context.agent_version,
            spec_hash=runtime_context.spec_hash,
            runtime_source=self._runtime_source(runtime_context),
            entrypoint=entrypoint,
            run_source=run_source,
            model=runtime_context.model,
            tools_json=self._runtime_tools_json(runtime_context),
            subagents_json=self._runtime_subagents_json(runtime_context),
            runtime_spec_json=self._runtime_spec_json(runtime_context),
            runtime_manifest_json=runtime_context.runtime_manifest_json,
            knowledge_count=runtime_context.knowledge_count,
            input_preview=input_text[:240],
            input_text=input_text[:20000],
        )
        self.session.add(run)
        self.session.commit()
        started = perf_counter()
        self._record_knowledge_audit(
            runtime_context,
            run_id=run.id,
            conversation_id=conversation_id,
            source=run_source,
            knowledge_result=knowledge_result,
        )
        events: List[Dict[str, Any]] = [
            trace_event("run_started", trace_label, started, resource=runtime_context.agent_id),
            trace_event("model_invoked", runtime_context.model, started, resource=runtime_context.model),
        ]
        events.extend(self._runtime_resource_events(runtime_context, started))
        if knowledge_event := self._knowledge_trace_event(knowledge_result, started):
            events.append(knowledge_event)
        yield {"type": "meta", "conversation_id": conversation_id, "run_id": run.id}
        try:
            compiled_plan = self._assert_execution_ready(runtime_context)
            deep_agent = await build_deep_agent_from_spec(
                runtime_spec=runtime_context.runtime_spec,
                session=self.session,
                release_id=runtime_context.release_id or f"preview-{run.id}",
                actor_role=self.actor_role,
                tool_invocation_context=ToolInvocationContext(
                    user_id=self.actor_user_id,
                    actor_role=self.actor_role,
                    source=run_source,
                    agent_id=runtime_context.agent_id,
                    run_id=run.id,
                    conversation_id=conversation_id,
                ),
                runtime_manifest=runtime_context.runtime_manifest,
                compiled_plan=compiled_plan,
            )
            graph_messages = to_graph_messages(messages)
            previous_text = ""
            seen_runtime_events: set[str] = set()
            last_usage = LLMUsageSummary()
            chunk_messages: list[Any] = []
            first_token_ms = 0

            async for chunk in deep_agent.astream(
                {"messages": graph_messages},
                config={
                    "recursion_limit": max(runtime_context.max_iterations, 2),
                    "configurable": {"thread_id": f"{runtime_context.thread_scope}:{conversation_id}"},
                },
                stream_mode="values",
            ):
                ensure_run_not_cancelled(self.session, run)
                chunk_messages = chunk.get("messages", [])
                events.extend(self._collect_runtime_events(chunk_messages, seen_runtime_events, started))
                last_usage = summarize_llm_usage(chunk_messages)
                content = final_ai_text(chunk_messages)
                if not content or content == previous_text:
                    continue
                if not any(item.get("type") == "first_token" for item in events):
                    first_token_ms = int((perf_counter() - started) * 1000)
                    events.append(trace_event("first_token", "模型开始输出", started, elapsed_ms=first_token_ms))
                delta = content[len(previous_text):] if content.startswith(previous_text) else content
                previous_text = content
                if delta:
                    yield {"type": "output_delta", "content": delta, "conversation_id": conversation_id, "run_id": run.id}

            if usage_event := self._llm_usage_trace_event(last_usage, started, chunk_messages):
                events.append(usage_event)
            if persist_messages and previous_text:
                self._append_message(conversation_id, "assistant", previous_text)
            run.status = "completed"
            run.output_preview = previous_text[:240]
            run.output_text = previous_text[:20000]
            run.duration_ms = int((perf_counter() - started) * 1000)
            self._apply_observability(run, last_usage, first_token_ms)
            self._record_llm_log(
                runtime_context=runtime_context,
                run=run,
                llm=llm,
                source=run_source,
                status="success",
                usage=last_usage,
                messages=chunk_messages,
                first_token_ms=first_token_ms,
            )
            write_run_events(self.session, run, [
                *events,
                trace_event("run_completed", done_label, started, elapsed_ms=run.duration_ms),
            ])
            run.ended_at = now_iso()
            self.session.add(run)
            self.session.commit()
            yield {"type": "completed", "conversation_id": conversation_id, "run_id": run.id}
        except RunCancelledError as exc:
            run.status = "cancelled"
            run.error = str(exc)[:500]
            run.duration_ms = int((perf_counter() - started) * 1000)
            write_run_events(self.session, run, [
                *events,
                trace_event("cancelled", "运行已取消", started, elapsed_ms=run.duration_ms, output_preview=run.error, status="error"),
            ])
            run.ended_at = now_iso()
            self.session.add(run)
            self.session.commit()
            yield {"type": "error", "message": f"运行已取消: {exc}", "conversation_id": conversation_id, "run_id": run.id}
        except RuntimeManifestMismatch as exc:
            run.status = "blocked"
            run.error = str(exc)[:500]
            run.duration_ms = int((perf_counter() - started) * 1000)
            write_run_events(self.session, run, [
                *events,
                trace_event(
                    "run_blocked",
                    "运行清单一致性校验失败",
                    started,
                    elapsed_ms=run.duration_ms,
                    status="error",
                    metadata={
                        "expected_hash": exc.expected_hash,
                        "actual_hash": exc.actual_hash,
                    },
                    output_preview=run.error,
                ),
            ])
            run.ended_at = now_iso()
            self.session.add(run)
            record_audit(
                self.session,
                action="agent_run.blocked",
                status="blocked",
                org_id=self.org_id,
                user_id=self.actor_user_id,
                resource_type="agent_run",
                resource_id=run.id,
                metadata={
                    "agent_id": runtime_context.agent_id,
                    "expected_hash": exc.expected_hash,
                    "actual_hash": exc.actual_hash,
                    "reason": "runtime_manifest_mismatch",
                },
            )
            self.session.commit()
            yield {"type": "error", "message": f"运行被阻断: {exc}", "conversation_id": conversation_id, "run_id": run.id}
        except RuntimeGovernanceBlocked as exc:
            run.status = "blocked"
            run.error = str(exc)[:500]
            run.duration_ms = int((perf_counter() - started) * 1000)
            issues = self._governance_issue_payloads(exc)
            write_run_events(self.session, run, [
                *events,
                trace_event(
                    "run_blocked",
                    "运行治理门阻断",
                    started,
                    elapsed_ms=run.duration_ms,
                    status="error",
                    metadata={"issues": issues},
                    output_preview=run.error,
                ),
            ])
            run.ended_at = now_iso()
            self.session.add(run)
            record_audit(
                self.session,
                action="agent_run.blocked",
                status="blocked",
                org_id=self.org_id,
                user_id=self.actor_user_id,
                resource_type="agent_run",
                resource_id=run.id,
                metadata={
                    "agent_id": runtime_context.agent_id,
                    "reason": "runtime_governance_gate",
                    "issues": issues,
                },
            )
            self.session.commit()
            yield {"type": "error", "message": f"运行被阻断: {exc}", "conversation_id": conversation_id, "run_id": run.id}
        except Exception as exc:
            run.status = "failed"
            run.error = str(exc)[:500]
            run.duration_ms = int((perf_counter() - started) * 1000)
            self._record_llm_log(runtime_context=runtime_context, run=run, llm=llm, source=run_source, status="failed", error=run.error)
            write_run_events(self.session, run, [
                *events,
                trace_event("error", error_label, started, elapsed_ms=run.duration_ms),
            ])
            run.ended_at = now_iso()
            self.session.add(run)
            self.session.commit()
            yield {"type": "error", "message": f"执行引擎失败: {exc}", "conversation_id": conversation_id, "run_id": run.id}
