from typing import Any

from sqlmodel import Session, select

from app.core.models import AgentRun, LLMConfig, LLMInvocationLog
from app.core.schemas import LLMInvocationLogRead
from app.services.llm_observability_service import LLMUsageBreakdown, LLMUsageSummary, summarize_llm_usage_breakdown
from app.services.runtime_plan_service import RuntimePlan


def _usage_from_breakdown(item: LLMUsageBreakdown) -> LLMUsageSummary:
    return LLMUsageSummary(
        input_tokens=item.input_tokens,
        output_tokens=item.output_tokens,
        total_tokens=item.total_tokens,
        llm_calls=item.llm_calls,
    )


def _usage_from_breakdowns(items: list[LLMUsageBreakdown]) -> LLMUsageSummary:
    return LLMUsageSummary(
        input_tokens=sum(item.input_tokens for item in items),
        output_tokens=sum(item.output_tokens for item in items),
        total_tokens=sum(item.total_tokens for item in items),
        llm_calls=sum(item.llm_calls for item in items),
    )


def _usage_matches_summary(
    breakdown: list[LLMUsageBreakdown],
    usage: LLMUsageSummary | None,
) -> bool:
    if not usage:
        return True
    breakdown_usage = _usage_from_breakdowns(breakdown)
    return (
        breakdown_usage.input_tokens == usage.input_tokens
        and breakdown_usage.output_tokens == usage.output_tokens
        and breakdown_usage.total_tokens == usage.total_tokens
        and breakdown_usage.llm_calls == usage.llm_calls
    )


def _canonical_model(value: str) -> str:
    raw = str(value or "").strip()
    if ":" in raw:
        return raw.split(":", 1)[1]
    return raw


def _model_matches_contract(observed_model: str, contract_model: str) -> bool:
    if not observed_model:
        return True
    return observed_model == contract_model or _canonical_model(observed_model) == _canonical_model(contract_model)


def _match_usage_contract(
    runtime_context: RuntimePlan,
    item: LLMUsageBreakdown,
) -> tuple[dict[str, Any] | None, str]:
    contracts = runtime_context.llm_usage_contracts()
    observed_model = item.model.strip()
    subagent = item.subagent.strip()

    if subagent:
        candidates = [
            contract
            for contract in contracts
            if contract.get("scope") == "subagent" and str(contract.get("subagent") or "") == subagent
        ]
        matched_by = "subagent"
    else:
        candidates = [contract for contract in contracts if contract.get("scope") == "main"]
        matched_by = "main"

    if len(candidates) != 1:
        return None, f"{matched_by}_ambiguous" if candidates else f"{matched_by}_unmatched"

    contract = candidates[0]
    if not _model_matches_contract(observed_model, str(contract.get("model") or "")):
        return None, f"{matched_by}_model_unmatched"
    return contract, matched_by


def _record_aggregate_fallback_log(
    session: Session,
    *,
    run: AgentRun,
    runtime_context: RuntimePlan,
    llm: LLMConfig,
    source: str,
    status: str,
    usage: LLMUsageSummary | None,
    duration_ms: int,
    first_token_ms: int,
    error: str,
    fallback_reason: str = "",
) -> LLMInvocationLog:
    fallback_error = error
    if fallback_reason:
        fallback_error = f"{error} | runtime_usage_fallback:{fallback_reason}" if error else f"runtime_usage_fallback:{fallback_reason}"
    return record_llm_invocation_log(
        session,
        run=run,
        llm=llm,
        source=source,
        status=status,
        usage=usage,
        runtime_scope="mixed" if fallback_reason else "main",
        duration_ms=duration_ms,
        first_token_ms=first_token_ms,
        error=fallback_error,
    )


def record_llm_invocation_log(
    session: Session,
    *,
    run: AgentRun,
    llm: LLMConfig,
    source: str,
    status: str,
    usage: LLMUsageSummary | None = None,
    model: str | None = None,
    runtime_scope: str = "main",
    subagent_name: str = "",
    duration_ms: int = 0,
    first_token_ms: int = 0,
    error: str = "",
) -> LLMInvocationLog:
    usage = usage or LLMUsageSummary()
    model_name = model or run.model
    row = LLMInvocationLog(
        org_id=run.org_id,
        agent_id=run.agent_id,
        run_id=run.id,
        conversation_id=run.conversation_id,
        llm_config_id=llm.id,
        provider_type=llm.provider_type,
        model=model_name,
        runtime_scope=runtime_scope or "main",
        subagent_name=subagent_name,
        source=source,
        status=status,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        total_tokens=usage.total_tokens,
        llm_calls=usage.llm_calls,
        duration_ms=max(duration_ms, 0),
        first_token_ms=max(first_token_ms, 0),
        error=error[:500],
    )
    session.add(row)
    return row


def record_llm_invocation_logs_from_messages(
    session: Session,
    *,
    run: AgentRun,
    runtime_context: RuntimePlan,
    llm: LLMConfig,
    source: str,
    status: str,
    usage: LLMUsageSummary | None = None,
    messages: list[Any] | None = None,
    duration_ms: int = 0,
    first_token_ms: int = 0,
    error: str = "",
) -> list[LLMInvocationLog]:
    breakdown = summarize_llm_usage_breakdown(messages or [])
    if status != "success" or not breakdown:
        return [
            _record_aggregate_fallback_log(
                session,
                run=run,
                runtime_context=runtime_context,
                llm=llm,
                source=source,
                status=status,
                usage=usage,
                duration_ms=duration_ms,
                first_token_ms=first_token_ms,
                error=error,
            )
        ]

    if not _usage_matches_summary(breakdown, usage):
        return [
            _record_aggregate_fallback_log(
                session,
                run=run,
                runtime_context=runtime_context,
                llm=llm,
                source=source,
                status=status,
                usage=usage,
                duration_ms=duration_ms,
                first_token_ms=first_token_ms,
                error=error,
                fallback_reason="usage_breakdown_mismatch",
            )
        ]

    matched_items: list[tuple[LLMUsageBreakdown, dict[str, Any], str, LLMConfig]] = []
    for item in breakdown:
        contract, matched_by = _match_usage_contract(runtime_context, item)
        if not contract:
            return [
                _record_aggregate_fallback_log(
                    session,
                    run=run,
                    runtime_context=runtime_context,
                    llm=llm,
                    source=source,
                    status=status,
                    usage=usage,
                    duration_ms=duration_ms,
                    first_token_ms=first_token_ms,
                    error=error,
                    fallback_reason=matched_by,
                )
            ]

        target_llm = runtime_context.llm_config_from_contract(
            str(contract.get("llm_config_id") or ""),
            scope=str(contract.get("scope") or ""),
            subagent=str(contract.get("subagent") or ""),
            model=str(contract.get("model") or ""),
        )
        if not target_llm:
            return [
                _record_aggregate_fallback_log(
                    session,
                    run=run,
                    runtime_context=runtime_context,
                    llm=llm,
                    source=source,
                    status=status,
                    usage=usage,
                    duration_ms=duration_ms,
                    first_token_ms=first_token_ms,
                    error=error,
                    fallback_reason="llm_contract_unavailable",
                )
            ]
        matched_items.append((item, contract, matched_by, target_llm))

    rows: list[LLMInvocationLog] = []
    for item, contract, matched_by, target_llm in matched_items:
        model_name = str(contract.get("model") or item.model or run.model)
        trace_error = error
        if matched_by and matched_by != "main":
            trace_error = f"{error} | matched_by:{matched_by}" if error else ""
        rows.append(
            record_llm_invocation_log(
                session,
                run=run,
                llm=target_llm,
                source=source,
                status=status,
                usage=_usage_from_breakdown(item),
                model=model_name,
                runtime_scope=str(contract.get("scope") or "main"),
                subagent_name=str(item.subagent or contract.get("subagent") or ""),
                duration_ms=duration_ms,
                first_token_ms=first_token_ms,
                error=trace_error,
            )
        )
    return rows


def list_llm_invocation_logs(
    session: Session,
    *,
    org_id: str,
    run_id: str | None = None,
    agent_id: str | None = None,
    llm_config_id: str | None = None,
    limit: int = 50,
) -> list[LLMInvocationLogRead]:
    stmt = select(LLMInvocationLog).where(LLMInvocationLog.org_id == org_id)
    if run_id:
        stmt = stmt.where(LLMInvocationLog.run_id == run_id)
    if agent_id:
        stmt = stmt.where(LLMInvocationLog.agent_id == agent_id)
    if llm_config_id:
        stmt = stmt.where(LLMInvocationLog.llm_config_id == llm_config_id)
    rows = session.exec(stmt.order_by(LLMInvocationLog.created_at.desc()).limit(min(limit, 100))).all()
    return [llm_invocation_log_to_read(row) for row in rows]


def llm_invocation_log_to_read(row: LLMInvocationLog) -> LLMInvocationLogRead:
    return LLMInvocationLogRead(
        id=row.id,
        org_id=row.org_id,
        agent_id=row.agent_id,
        run_id=row.run_id,
        conversation_id=row.conversation_id,
        llm_config_id=row.llm_config_id,
        provider_type=row.provider_type,
        model=row.model,
        runtime_scope=row.runtime_scope,
        subagent_name=row.subagent_name,
        source=row.source,
        status=row.status,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        total_tokens=row.total_tokens,
        llm_calls=row.llm_calls,
        duration_ms=row.duration_ms,
        first_token_ms=row.first_token_ms,
        error=row.error,
        created_at=row.created_at,
    )
