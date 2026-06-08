from typing import Dict
from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from sqlmodel import Session, func, select

from app.api.deps import AuthContext, get_current_context, require_role
from app.core.models import Agent, AgentRun, AgentTestCase, Conversation, KnowledgeDocument, LLMConfig, LLMInvocationLog, Message
from app.core.schemas import (
    LLMHealthBreakdownItemRead,
    LLMHealthBreakdownRead,
    LLMUsageBreakdownItemRead,
    LLMUsageBreakdownRead,
    PlatformReadinessCheck,
    PlatformReadinessRead,
    MonitorStatsRead,
    RunRetentionCandidateRead,
    RunRetentionPolicyRead,
    RunRetentionRead,
    RunRetentionRequest,
    RuntimeStateRead,
    UploadQuotaRead,
)
from app.db.session import get_session
from app.config import settings
from app.services.runtime_adapter.state_store import runtime_state_config_evidence, runtime_state_config_warnings
from app.services.runtime_state_service import runtime_state_snapshot, runtime_state_stats
from app.services.runtime_plan_service import build_preview_runtime_plan
from app.services.regression_coverage_service import build_regression_run_index
from app.services.run_retention_service import (
    RunRetentionPolicy,
    RunRetentionResult,
    apply_run_retention,
    preview_run_retention,
)
from app.services.secret_codec import secret_readiness
from app.services.upload_quota_service import UploadQuotaPolicy, get_upload_quota_usage
from app.core.models import now_iso

router = APIRouter(prefix="/monitor", tags=["monitor"])


@router.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@router.get("/readiness", response_model=PlatformReadinessRead)
def readiness(_: AuthContext = Depends(require_role("admin"))) -> PlatformReadinessRead:
    checks = [
        _secret_key_readiness(),
        _database_readiness(),
        _runtime_state_readiness(),
        _upload_quota_readiness(),
        _run_retention_readiness(),
        _mcp_stdio_readiness(),
        _egress_readiness(),
    ]
    blockers = sum(1 for item in checks if not item.ready and item.severity == "blocker")
    warnings = sum(1 for item in checks if not item.ready and item.severity == "warning")
    status = "blocked" if blockers else "degraded" if warnings else "ready"
    return PlatformReadinessRead(
        status=status,
        environment=settings.env,
        checked_at=now_iso(),
        blockers=blockers,
        warnings=warnings,
        checks=checks,
    )


def _secret_key_readiness() -> PlatformReadinessCheck:
    secret_state = secret_readiness()
    return PlatformReadinessCheck(
        key="secret_key",
        label="密钥加密主密钥",
        ready=bool(secret_state["ready"]),
        severity="blocker",
        detail=str(secret_state["message"]),
        evidence={
            "environment": secret_state["environment"],
            "default_key": secret_state["default_key"],
        },
    )


def _database_readiness() -> PlatformReadinessCheck:
    parsed = urlparse(settings.database_url)
    backend = parsed.scheme.split("+", 1)[0] or "sqlite"
    production_sqlite = settings.env == "production" and backend == "sqlite"
    return PlatformReadinessCheck(
        key="database_backend",
        label="数据库后端",
        ready=not production_sqlite,
        severity="blocker",
        detail="生产环境应使用 PostgreSQL。" if production_sqlite else f"当前数据库后端为 {backend}。",
        evidence={
            "backend": backend,
            "production": settings.env == "production",
        },
    )


def _runtime_state_readiness() -> PlatformReadinessCheck:
    config_warnings = runtime_state_config_warnings()
    shared_env_misconfigured = settings.env in {"staging", "production"} and bool(config_warnings)
    return PlatformReadinessCheck(
        key="runtime_state_backend",
        label="运行态存储",
        ready=not shared_env_misconfigured,
        severity="blocker",
        detail="；".join(config_warnings) if shared_env_misconfigured else f"运行态后端为 {settings.runtime_state_backend}。",
        evidence=runtime_state_config_evidence(),
    )


def _upload_quota_readiness() -> PlatformReadinessCheck:
    quota_ready = settings.upload_quota_total_bytes > 0
    upload_limit_ready = settings.upload_max_bytes > 0 and settings.knowledge_upload_max_bytes > 0
    ready = quota_ready and upload_limit_ready
    return PlatformReadinessCheck(
        key="upload_quota",
        label="上传配额",
        ready=ready,
        severity="warning",
        detail="上传大小与租户总配额已配置。" if ready else "上传大小或租户总配额未正确配置。",
        evidence={
            "upload_max_bytes": settings.upload_max_bytes,
            "knowledge_upload_max_bytes": settings.knowledge_upload_max_bytes,
            "upload_quota_total_bytes": settings.upload_quota_total_bytes,
        },
    )


def _run_retention_readiness() -> PlatformReadinessCheck:
    ready = settings.run_retention_days > 0 and settings.run_retention_minimum >= 0
    return PlatformReadinessCheck(
        key="run_retention",
        label="运行保留策略",
        ready=ready,
        severity="warning",
        detail="运行保留策略已配置。" if ready else "运行保留策略配置无效。",
        evidence={
            "retain_days": settings.run_retention_days,
            "retain_minimum": settings.run_retention_minimum,
        },
    )


def _mcp_stdio_readiness() -> PlatformReadinessCheck:
    allowlist_ready = bool(settings.mcp_stdio_allowed_commands) and bool(settings.mcp_stdio_allowed_cwd_roots)
    ready = not settings.mcp_stdio_enabled or allowlist_ready
    return PlatformReadinessCheck(
        key="mcp_stdio_guard",
        label="MCP stdio 安全",
        ready=ready,
        severity="blocker" if settings.env == "production" else "warning",
        detail="MCP stdio 已禁用或已配置命令与工作目录 allowlist。" if ready else "MCP stdio 启用时必须配置命令与工作目录 allowlist。",
        evidence={
            "enabled": settings.mcp_stdio_enabled,
            "allowed_commands": settings.mcp_stdio_allowed_commands,
            "allowed_cwd_roots": [str(item) for item in settings.mcp_stdio_allowed_cwd_roots],
        },
    )


def _egress_readiness() -> PlatformReadinessCheck:
    risky_private_egress = settings.env == "production" and (
        settings.egress_allow_private_networks or settings.egress_allow_localhost
    )
    ready = not risky_private_egress
    return PlatformReadinessCheck(
        key="egress_policy",
        label="工具访问边界",
        ready=ready,
        severity="blocker",
        detail="生产环境工具访问边界未允许私网/本机地址。" if ready else "生产环境不应允许工具访问私网或 localhost。",
        evidence={
            "allowed_hosts": settings.egress_allowed_hosts,
            "blocked_hosts": settings.egress_blocked_hosts,
            "allow_private_networks": settings.egress_allow_private_networks,
            "allow_localhost": settings.egress_allow_localhost,
        },
    )


@router.get("/stats", response_model=MonitorStatsRead)
def stats(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> MonitorStatsRead:
    org_id = context.organization.id

    def count(model) -> int:
        return session.exec(select(func.count()).select_from(model).where(model.org_id == org_id)).one()

    run_total = count(AgentRun)
    completed_runs = session.exec(
        select(func.count()).select_from(AgentRun).where(AgentRun.org_id == org_id, AgentRun.status == "completed")
    ).one()
    failed_runs = session.exec(
        select(func.count()).select_from(AgentRun).where(AgentRun.org_id == org_id, AgentRun.status == "failed")
    ).one()
    running_runs = session.exec(
        select(func.count()).select_from(AgentRun).where(AgentRun.org_id == org_id, AgentRun.status == "running")
    ).one()
    cancelled_runs = session.exec(
        select(func.count()).select_from(AgentRun).where(AgentRun.org_id == org_id, AgentRun.status == "cancelled")
    ).one()
    stale_runs = session.exec(
        select(func.count()).select_from(AgentRun).where(AgentRun.org_id == org_id, AgentRun.status == "stale")
    ).one()
    avg_duration = session.exec(
        select(func.avg(AgentRun.duration_ms)).where(AgentRun.org_id == org_id, AgentRun.duration_ms > 0)
    ).one()
    avg_first_token = session.exec(
        select(func.avg(AgentRun.first_token_ms)).where(AgentRun.org_id == org_id, AgentRun.first_token_ms > 0)
    ).one()
    total_tokens = session.exec(
        select(func.sum(AgentRun.total_tokens)).where(AgentRun.org_id == org_id)
    ).one()
    input_tokens = session.exec(
        select(func.sum(AgentRun.input_tokens)).where(AgentRun.org_id == org_id)
    ).one()
    output_tokens = session.exec(
        select(func.sum(AgentRun.output_tokens)).where(AgentRun.org_id == org_id)
    ).one()
    llm_calls = session.exec(
        select(func.sum(AgentRun.llm_calls)).where(AgentRun.org_id == org_id)
    ).one()

    return MonitorStatsRead(**{
        "agents": count(Agent),
        "published_agents": session.exec(
            select(func.count()).select_from(Agent).where(Agent.org_id == org_id, Agent.status == "published")
        ).one(),
        "llm_configs": count(LLMConfig),
        "active_llm_configs": session.exec(
            select(func.count()).select_from(LLMConfig).where(LLMConfig.org_id == org_id, LLMConfig.status == "active")
        ).one(),
        "conversations": count(Conversation),
        "messages": count(Message),
        "runs": run_total,
        "completed_runs": completed_runs,
        "failed_runs": failed_runs,
        "running_runs": running_runs,
        "cancelled_runs": cancelled_runs,
        "stale_runs": stale_runs,
        "success_rate": round(completed_runs / run_total * 100) if run_total else 0,
        "avg_duration_ms": round(avg_duration or 0),
        "avg_first_token_ms": round(avg_first_token or 0),
        "input_tokens": int(input_tokens or 0),
        "output_tokens": int(output_tokens or 0),
        "total_tokens": int(total_tokens or 0),
        "llm_calls": int(llm_calls or 0),
        "knowledge_documents": count(KnowledgeDocument),
        "test_cases": count(AgentTestCase),
        "passed_test_cases": _current_passed_test_cases(session, org_id),
        **runtime_state_stats(),
    })


@router.get("/llm-usage-breakdown", response_model=LLMUsageBreakdownRead)
def llm_usage_breakdown(
    limit: int = 20,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> LLMUsageBreakdownRead:
    org_id = context.organization.id
    rows = session.exec(
        select(
            LLMInvocationLog.runtime_scope,
            LLMInvocationLog.subagent_name,
            LLMInvocationLog.provider_type,
            LLMInvocationLog.model,
            LLMInvocationLog.llm_config_id,
            func.sum(LLMInvocationLog.llm_calls),
            func.sum(LLMInvocationLog.input_tokens),
            func.sum(LLMInvocationLog.output_tokens),
            func.sum(LLMInvocationLog.total_tokens),
        )
        .where(LLMInvocationLog.org_id == org_id)
        .group_by(
            LLMInvocationLog.runtime_scope,
            LLMInvocationLog.subagent_name,
            LLMInvocationLog.provider_type,
            LLMInvocationLog.model,
            LLMInvocationLog.llm_config_id,
        )
    ).all()
    items: list[LLMUsageBreakdownItemRead] = []
    for (
        scope,
        subagent,
        provider,
        model,
        llm_config_id,
        calls,
        input_tokens,
        output_tokens,
        total_tokens,
    ) in rows:
        items.append(
            LLMUsageBreakdownItemRead(
                runtime_scope=str(scope or "main"),
                subagent_name=str(subagent or ""),
                provider_type=str(provider or ""),
                model=str(model or ""),
                llm_config_id=str(llm_config_id or ""),
                llm_calls=int(calls or 0),
                input_tokens=int(input_tokens or 0),
                output_tokens=int(output_tokens or 0),
                total_tokens=int(total_tokens or 0),
            )
        )

    all_items = sorted(items, key=lambda item: (item.total_tokens, item.llm_calls), reverse=True)
    visible_items = all_items[: min(max(limit, 1), 100)]
    return LLMUsageBreakdownRead(
        total_llm_calls=sum(item.llm_calls for item in all_items),
        input_tokens=sum(item.input_tokens for item in all_items),
        output_tokens=sum(item.output_tokens for item in all_items),
        total_tokens=sum(item.total_tokens for item in all_items),
        items=visible_items,
    )


@router.get("/llm-health-breakdown", response_model=LLMHealthBreakdownRead)
def llm_health_breakdown(
    limit: int = 20,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> LLMHealthBreakdownRead:
    org_id = context.organization.id
    rows = session.exec(
        select(
            LLMInvocationLog.runtime_scope,
            LLMInvocationLog.subagent_name,
            LLMInvocationLog.provider_type,
            LLMInvocationLog.model,
            LLMInvocationLog.llm_config_id,
            LLMInvocationLog.status,
            LLMInvocationLog.error,
            func.sum(LLMInvocationLog.llm_calls),
            func.sum(LLMInvocationLog.duration_ms),
            func.sum(LLMInvocationLog.first_token_ms),
            func.sum(LLMInvocationLog.total_tokens),
        )
        .where(LLMInvocationLog.org_id == org_id)
        .group_by(
            LLMInvocationLog.runtime_scope,
            LLMInvocationLog.subagent_name,
            LLMInvocationLog.provider_type,
            LLMInvocationLog.model,
            LLMInvocationLog.llm_config_id,
            LLMInvocationLog.status,
            LLMInvocationLog.error,
        )
    ).all()
    grouped: dict[tuple[str, str, str, str, str], LLMHealthBreakdownItemRead] = {}
    duration_weighted_sum = 0
    first_token_weighted_sum = 0
    for (
        scope,
        subagent,
        provider,
        model,
        llm_config_id,
        status,
        error,
        calls,
        duration_ms,
        first_token_ms,
        total_tokens,
    ) in rows:
        key = (
            str(scope or "main"),
            str(subagent or ""),
            str(provider or ""),
            str(model or ""),
            str(llm_config_id or ""),
        )
        item = grouped.setdefault(
            key,
            LLMHealthBreakdownItemRead(
                runtime_scope=key[0],
                subagent_name=key[1],
                provider_type=key[2],
                model=key[3],
                llm_config_id=key[4],
            ),
        )
        call_count = max(int(calls or 0), 0)
        item.total_llm_calls += call_count
        item.total_tokens += int(total_tokens or 0)
        item.avg_duration_ms += int(duration_ms or 0)
        item.avg_first_token_ms += int(first_token_ms or 0)
        if status == "failed" or error:
            item.failed_llm_calls += call_count
            if error and not item.last_error:
                item.last_error = str(error)[:240]
        else:
            item.success_llm_calls += call_count
        duration_weighted_sum += int(duration_ms or 0)
        first_token_weighted_sum += int(first_token_ms or 0)

    all_items: list[LLMHealthBreakdownItemRead] = []
    for item in grouped.values():
        if item.total_llm_calls > 0:
            item.success_rate = round(item.success_llm_calls / item.total_llm_calls * 100)
            item.avg_duration_ms = round(item.avg_duration_ms / item.total_llm_calls)
            item.avg_first_token_ms = round(item.avg_first_token_ms / item.total_llm_calls)
        all_items.append(item)

    total_calls = sum(item.total_llm_calls for item in all_items)
    success_calls = sum(item.success_llm_calls for item in all_items)
    failed_calls = sum(item.failed_llm_calls for item in all_items)
    visible_items = sorted(
        all_items,
        key=lambda item: (-item.failed_llm_calls, item.success_rate, -item.total_llm_calls),
    )[: min(max(limit, 1), 100)]
    return LLMHealthBreakdownRead(
        total_llm_calls=total_calls,
        success_llm_calls=success_calls,
        failed_llm_calls=failed_calls,
        success_rate=round(success_calls / total_calls * 100) if total_calls else 0,
        avg_duration_ms=round(duration_weighted_sum / total_calls) if total_calls else 0,
        avg_first_token_ms=round(first_token_weighted_sum / total_calls) if total_calls else 0,
        items=visible_items,
    )


@router.get("/runtime-state", response_model=RuntimeStateRead)
def runtime_state(
    _: AuthContext = Depends(get_current_context),
) -> RuntimeStateRead:
    return RuntimeStateRead(**runtime_state_snapshot())


@router.get("/upload-quota", response_model=UploadQuotaRead)
def upload_quota(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> UploadQuotaRead:
    usage = get_upload_quota_usage(
        session,
        context.organization.id,
        UploadQuotaPolicy(max_total_bytes=settings.upload_quota_total_bytes),
    )
    usage_percent = round(usage.used_bytes / usage.max_total_bytes * 100) if usage.max_total_bytes else 0
    return UploadQuotaRead(
        max_total_bytes=usage.max_total_bytes,
        used_bytes=usage.used_bytes,
        remaining_bytes=usage.remaining_bytes,
        attachment_bytes=usage.attachment_bytes,
        knowledge_bytes=usage.knowledge_bytes,
        usage_percent=usage_percent,
        upload_max_bytes=settings.upload_max_bytes,
        knowledge_upload_max_bytes=settings.knowledge_upload_max_bytes,
        allowed_extensions=settings.text_upload_extensions,
        allowed_content_types=sorted(set(settings.upload_allowed_content_types + settings.knowledge_allowed_content_types)),
    )


@router.get("/run-retention", response_model=RunRetentionRead)
def run_retention_policy(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> RunRetentionRead:
    return _retention_to_read(
        preview_run_retention(
            session,
            context.organization.id,
            _policy_from_request(None),
        )
    )


@router.post("/run-retention/preview", response_model=RunRetentionRead)
def preview_retention(
    payload: RunRetentionRequest,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> RunRetentionRead:
    return _retention_to_read(
        preview_run_retention(
            session,
            context.organization.id,
            _policy_from_request(payload),
        )
    )


@router.post("/run-retention/apply", response_model=RunRetentionRead)
def apply_retention(
    payload: RunRetentionRequest,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> RunRetentionRead:
    return _retention_to_read(
        apply_run_retention(
            session,
            context.organization.id,
            _policy_from_request(payload),
        )
    )


def _current_passed_test_cases(session: Session, org_id: str) -> int:
    agents = session.exec(select(Agent).where(Agent.org_id == org_id)).all()
    if not agents:
        return 0
    active_cases = session.exec(
        select(AgentTestCase).where(AgentTestCase.org_id == org_id, AgentTestCase.status == "active")
    ).all()
    cases_by_agent = _group_test_cases_by_agent(active_cases)
    passed = 0
    for agent in agents:
        cases = cases_by_agent.get(agent.id, [])
        if not cases:
            continue
        runtime_plan_hash = build_preview_runtime_plan(agent, session).spec_hash
        run_index = build_regression_run_index(
            session,
            org_id=org_id,
            agent_id=agent.id,
            case_ids=[case.id for case in cases],
            runtime_plan_hash=runtime_plan_hash,
        )
        passed += sum(
            1
            for case in cases
            if (test_run := run_index.current_for_case(case.id))
            and test_run.status == "passed"
            and test_run.runtime_plan_hash == runtime_plan_hash
        )
    return passed


def _group_test_cases_by_agent(cases: list[AgentTestCase]) -> dict[str, list[AgentTestCase]]:
    grouped: dict[str, list[AgentTestCase]] = {}
    for case in cases:
        grouped.setdefault(case.agent_id, []).append(case)
    return grouped


def _policy_from_request(payload: RunRetentionRequest | None) -> RunRetentionPolicy:
    return RunRetentionPolicy(
        retain_days=payload.retain_days if payload and payload.retain_days is not None else settings.run_retention_days,
        retain_minimum=(
            payload.retain_minimum
            if payload and payload.retain_minimum is not None
            else settings.run_retention_minimum
        ),
        include_running=payload.include_running if payload else False,
    )


def _retention_to_read(result: RunRetentionResult) -> RunRetentionRead:
    return RunRetentionRead(
        policy=RunRetentionPolicyRead(
            retain_days=result.policy.retain_days,
            retain_minimum=result.policy.retain_minimum,
            include_running=result.policy.include_running,
        ),
        total_runs=result.total_runs,
        eligible_runs=result.eligible_runs,
        retained_runs=result.retained_runs,
        deleted_runs=result.deleted_runs,
        protected_test_runs=result.protected_test_runs,
        protected_minimum_runs=result.protected_minimum_runs,
        protected_running_runs=result.protected_running_runs,
        deleted_llm_logs=result.deleted_llm_logs,
        deleted_tool_audits=result.deleted_tool_audits,
        deleted_knowledge_audits=result.deleted_knowledge_audits,
        deleted_run_events=result.deleted_run_events,
        cleared_rerun_links=result.cleared_rerun_links,
        cutoff_at=result.cutoff_at,
        dry_run=result.dry_run,
        candidate_runs=[
            RunRetentionCandidateRead(
                id=item.id,
                agent_id=item.agent_id,
                status=item.status,
                started_at=item.started_at,
                ended_at=item.ended_at,
            )
            for item in result.candidate_runs
        ],
    )
