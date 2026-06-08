import re
import json
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlmodel import Session, select

from app.api.deps import AuthContext, get_current_context, require_role
from app.core.models import Agent, AgentRun, AgentTestCase, LLMInvocationLog, new_id, now_iso
from app.core.schemas import (
    AgentRunRead,
    AgentTestCaseRead,
    KnowledgeRetrievalAuditRead,
    LLMInvocationLogRead,
    RunEvidenceRead,
    RunRecoveryDeltaRead,
    RunRecoveryRead,
    RunRecoverySnapshotRead,
    RunIncidentAgentRead,
    RunIncidentItemRead,
    RunIncidentQueueRead,
    RunIncidentSummaryRead,
    RunTraceEvent,
    RunToTestCaseRequest,
)
from app.db.session import get_session
from app.services.agent_execution_service import AgentExecutionService
from app.services.execution_gateway import ExecutionGateway, ExecutionGatewayOptions
from app.services.knowledge_retrieval_audit_service import list_knowledge_retrieval_audits
from app.services.llm_invocation_log_service import list_llm_invocation_logs
from app.services.mappers import _dumps, _loads
from app.services.metadata_security import redact_sensitive_metadata
from app.services.openai_compatible_service import ResponsesRequest, responses_to_execution
from app.services.run_event_service import read_run_events
from app.services.run_governance_service import cancel_run, mark_stale_runs
from app.services.runtime_plan_service import build_run_snapshot_runtime_plan
from app.services.tenant_scope import get_agent_or_404, get_run_or_404
from app.services.tool_registry import list_tool_audits

router = APIRouter(prefix="/runs", tags=["runs"])


INCIDENT_STATUSES = ("failed", "stale", "cancelled", "blocked")
INCIDENT_QUEUE_META = {
    "blocked": {"label": "运行阻断", "severity": "critical"},
    "failed": {"label": "失败运行", "severity": "critical"},
    "stale": {"label": "失联运行", "severity": "critical"},
    "cancelled": {"label": "已取消", "severity": "info"},
}
KEYWORD_STOP_WORDS = {
    "一个",
    "可以",
    "已经",
    "当前",
    "需要",
    "没有",
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
}


def _test_case_to_read(row: AgentTestCase) -> AgentTestCaseRead:
    expected_keywords = _loads(row.expected_keywords_json, [])
    assertion = _loads(row.assertion_json, {})
    if expected_keywords and not assertion.get("required_keywords"):
        assertion["required_keywords"] = expected_keywords
    return AgentTestCaseRead(
        id=row.id,
        org_id=row.org_id,
        agent_id=row.agent_id,
        name=row.name,
        input_text=row.input_text,
        expected_keywords=expected_keywords,
        assertion=assertion,
        status=row.status,
        last_status=row.last_status,
        last_output=row.last_output,
        last_error=row.last_error,
        last_run_id=row.last_run_id,
        last_runtime_plan_hash=row.last_runtime_plan_hash,
        last_run_at=row.last_run_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _derived_run_count(run: AgentRun, session: Session) -> int:
    count = session.exec(
        select(func.count())
        .select_from(AgentRun)
        .where(AgentRun.org_id == run.org_id, AgentRun.rerun_of_run_id == run.id)
    ).one()
    return int(count or 0)


def _to_read(run: AgentRun, session: Session) -> AgentRunRead:
    try:
        tools = json.loads(run.tools_json)
    except json.JSONDecodeError:
        tools = []
    events = read_run_events(session, run)
    try:
        subagents = json.loads(run.subagents_json)
    except json.JSONDecodeError:
        subagents = []
    agent = session.get(Agent, run.agent_id)
    agent_name = agent.name if agent and agent.org_id == run.org_id else ""
    runtime_manifest = None
    manifest_hash = ""
    if agent and agent.org_id == run.org_id:
        try:
            runtime_plan = build_run_snapshot_runtime_plan(agent, run)
            runtime_manifest = runtime_plan.runtime_manifest
            manifest_hash = runtime_plan.manifest_hash
        except ValueError:
            runtime_manifest = None
    return AgentRunRead(
        id=run.id,
        org_id=run.org_id,
        agent_id=run.agent_id,
        agent_name=agent_name,
        conversation_id=run.conversation_id,
        rerun_of_run_id=run.rerun_of_run_id,
        derived_run_count=_derived_run_count(run, session),
        release_id=run.release_id,
        agent_version=run.agent_version,
        spec_hash=run.spec_hash,
        manifest_hash=manifest_hash,
        runtime_source=run.runtime_source,
        entrypoint=run.entrypoint,
        run_source=run.run_source,
        status=run.status,
        model=run.model,
        tools=tools,
        input_preview=run.input_preview,
        input_text=run.input_text,
        output_preview=run.output_preview,
        output_text=run.output_text,
        error=run.error,
        duration_ms=run.duration_ms,
        first_token_ms=run.first_token_ms,
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        total_tokens=run.total_tokens,
        llm_calls=run.llm_calls,
        events=events,
        subagents=subagents,
        runtime_manifest=runtime_manifest,
        knowledge_count=run.knowledge_count,
        started_at=run.started_at,
        ended_at=run.ended_at,
    )


def _replay_request(run: AgentRun) -> dict:
    metadata = {
        "source": "run-evidence-replay",
        "source_run_id": run.id,
        "original_entrypoint": run.entrypoint or "responses",
        "original_run_source": run.run_source or "runtime",
    }
    if run.release_id:
        metadata["release_id"] = run.release_id
    if run.agent_version:
        metadata["agent_version"] = run.agent_version
    if run.spec_hash:
        metadata["spec_hash"] = run.spec_hash
    return {
        "method": "POST",
        "path": "/v1/responses",
        "body": {
            "model": f"agent:{run.agent_id}",
            "input": run.input_text or run.input_preview or "",
            "stream": True,
            "metadata": metadata,
        },
    }


def _runtime_snapshot(run: AgentRun) -> dict:
    runtime_spec = _loads(run.runtime_spec_json, {})
    if not isinstance(runtime_spec, dict) or not runtime_spec:
        return {}
    snapshot = redact_sensitive_metadata(runtime_spec)
    knowledge_items = []
    for item in snapshot.get("knowledge") or []:
        if not isinstance(item, dict):
            continue
        knowledge_items.append({
            "id": item.get("id") or "",
            "file_name": item.get("file_name") or "",
            "content_type": item.get("content_type") or "",
            "size": item.get("size") or 0,
            "snapshot_size": item.get("snapshot_size") or 0,
            "char_count": item.get("char_count") or 0,
            "content_hash": item.get("content_hash") or "",
            "chunk_count": item.get("chunk_count") or len(item.get("chunks") or []),
            "chunk_source": item.get("chunk_source") or "",
            "created_at": item.get("created_at") or "",
        })
    snapshot["knowledge"] = knowledge_items
    return snapshot


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _age_minutes(started_at: str | None, now: datetime) -> int:
    started = _parse_iso_datetime(started_at)
    if not started:
        return 0
    return max(int((now - started).total_seconds() // 60), 0)


def _clip_text(value: str | None, limit: int = 180) -> str:
    text = " ".join((value or "").split())
    if len(text) <= limit:
        return text
    return f"{text[:limit - 1]}…"


def _suggest_keywords(value: str, limit: int = 4) -> list[str]:
    text = " ".join(value.split())
    if not text:
        return []
    candidates = re.findall(r"[\u4e00-\u9fff]{2,8}|[A-Za-z][A-Za-z0-9_-]{2,}", text)
    keywords: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = candidate.strip()
        key = normalized.lower()
        if key in seen or key in KEYWORD_STOP_WORDS:
            continue
        seen.add(key)
        keywords.append(normalized)
        if len(keywords) >= limit:
            break
    return keywords


def _first_error_event(run: AgentRun, session: Session) -> dict:
    for event in read_run_events(session, run):
        if not isinstance(event, dict):
            continue
        if event.get("phase") == "error" or event.get("status") == "error":
            return event
    return {}


def _incident_reason(run: AgentRun, age_minutes: int, session: Session) -> tuple[str, str, str]:
    if run.status == "running":
        return "疑似失联", f"运行已持续 {age_minutes} 分钟，超过失联阈值", "critical"
    if run.status == "stale":
        return "运行失联", run.error or "运行超过阈值后被标记为失联", "critical"
    if run.status == "blocked":
        return "运行阻断", run.error or "运行前一致性或治理门阻断", "critical"
    if run.status == "cancelled":
        return "人工取消", run.error or "运行被人工取消或治理策略终止", "info"

    event = _first_error_event(run, session)
    phase = str(event.get("phase") or "")
    resource = str(event.get("resource") or event.get("subagent") or "")
    label = str(event.get("label") or event.get("type") or "")
    output = event.get("output") or event.get("output_preview") or ""
    evidence = _clip_text(str(output or run.error or label or "没有记录详细错误信息"))
    if phase == "tool" or resource:
        return "工具/资源失败", evidence, "critical"
    if phase == "subagent":
        return "子代理失败", evidence, "critical"
    return "运行失败", evidence, "critical"


def _run_incident_item(run: AgentRun, agent_name: str, now: datetime, session: Session) -> RunIncidentItemRead:
    age = _age_minutes(run.started_at, now)
    reason, evidence, severity = _incident_reason(run, age, session)
    return RunIncidentItemRead(
        run_id=run.id,
        agent_id=run.agent_id,
        agent_name=agent_name,
        status=run.status,
        severity=severity,
        reason=reason,
        evidence=_clip_text(evidence),
        model=run.model,
        release_id=run.release_id,
        agent_version=run.agent_version,
        spec_hash=run.spec_hash,
        input_preview=_clip_text(run.input_preview or run.input_text, 120),
        error_preview=_clip_text(run.error, 160),
        duration_ms=run.duration_ms,
        age_minutes=age,
        started_at=run.started_at,
        ended_at=run.ended_at,
    )


def _recovery_snapshot(
    run: AgentRun,
    agent_name: str,
) -> RunRecoverySnapshotRead:
    return RunRecoverySnapshotRead(
        run_id=run.id,
        agent_id=run.agent_id,
        agent_name=agent_name,
        status=run.status,
        model=run.model,
        input_preview=_clip_text(run.input_preview or run.input_text, 120),
        output_preview=_clip_text(run.output_preview or run.output_text, 120),
        error_preview=_clip_text(run.error, 160),
        duration_ms=run.duration_ms,
        first_token_ms=run.first_token_ms,
        total_tokens=run.total_tokens,
        llm_calls=run.llm_calls,
        started_at=run.started_at,
        ended_at=run.ended_at,
    )


def _recovery_status(source_run: AgentRun, latest_rerun: AgentRun | None) -> tuple[str, str]:
    if latest_rerun is None:
        return "not_rerun", "还没有重跑记录"
    if latest_rerun.status == "completed":
        if source_run.status == "completed":
            return "recovered", "最近重跑成功，可作为输出对比样本"
        return "recovered", "最近重跑已成功，事故处置具备恢复证据"
    if latest_rerun.status == "running":
        return "verifying", "最近重跑仍在运行，等待验证结果"
    return "unresolved", "最近重跑仍未成功，事故尚未恢复"


def _recovery_delta(source: RunRecoverySnapshotRead, target: RunRecoverySnapshotRead | None) -> RunRecoveryDeltaRead:
    if not target:
        return RunRecoveryDeltaRead()
    return RunRecoveryDeltaRead(
        duration_ms=target.duration_ms - source.duration_ms,
        first_token_ms=target.first_token_ms - source.first_token_ms,
        total_tokens=target.total_tokens - source.total_tokens,
        llm_calls=target.llm_calls - source.llm_calls,
    )


@router.get("", response_model=List[AgentRunRead])
def list_runs(
    agent_id: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 30,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[AgentRunRead]:
    org_id = context.organization.id
    stmt = select(AgentRun).where(AgentRun.org_id == org_id)
    if agent_id:
        get_agent_or_404(session, agent_id, org_id)
        stmt = stmt.where(AgentRun.agent_id == agent_id)
    if status:
        stmt = stmt.where(AgentRun.status == status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (AgentRun.input_preview.like(like))
            | (AgentRun.output_preview.like(like))
            | (AgentRun.error.like(like))
            | (AgentRun.model.like(like))
        )
    stmt = stmt.order_by(AgentRun.started_at.desc()).limit(min(limit, 100))
    rows = session.exec(stmt).all()
    return [_to_read(run, session) for run in rows]


@router.get("/incidents", response_model=RunIncidentSummaryRead)
def get_run_incidents(
    window_minutes: int = 1440,
    stale_threshold_minutes: int = 120,
    queue_limit: int = 5,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> RunIncidentSummaryRead:
    window_minutes = min(max(window_minutes, 15), 60 * 24 * 30)
    stale_threshold_minutes = min(max(stale_threshold_minutes, 5), 60 * 24 * 7)
    queue_limit = min(max(queue_limit, 1), 20)
    org_id = context.organization.id
    current_time = datetime.now(timezone.utc)
    cutoff_iso = (current_time - timedelta(minutes=window_minutes)).isoformat()
    stale_cutoff_iso = (current_time - timedelta(minutes=stale_threshold_minutes)).isoformat()
    incident_filter = or_(
        (AgentRun.status.in_(INCIDENT_STATUSES)) & (AgentRun.started_at >= cutoff_iso),
        (AgentRun.status == "running") & (AgentRun.started_at <= stale_cutoff_iso),
    )
    count_rows = session.exec(
        select(AgentRun.agent_id, AgentRun.status, func.count())
        .where(AgentRun.org_id == org_id, incident_filter)
        .group_by(AgentRun.agent_id, AgentRun.status)
    ).all()
    failed_samples = session.exec(
        select(AgentRun)
        .where(AgentRun.org_id == org_id, AgentRun.status == "failed", AgentRun.started_at >= cutoff_iso)
        .order_by(AgentRun.started_at.desc())
        .limit(queue_limit)
    ).all()
    blocked_samples = session.exec(
        select(AgentRun)
        .where(AgentRun.org_id == org_id, AgentRun.status == "blocked", AgentRun.started_at >= cutoff_iso)
        .order_by(AgentRun.started_at.desc())
        .limit(queue_limit)
    ).all()
    stale_samples = session.exec(
        select(AgentRun)
        .where(
            AgentRun.org_id == org_id,
            or_(
                (AgentRun.status == "stale") & (AgentRun.started_at >= cutoff_iso),
                (AgentRun.status == "running") & (AgentRun.started_at <= stale_cutoff_iso),
            ),
        )
        .order_by(AgentRun.started_at.desc())
        .limit(queue_limit)
    ).all()
    cancelled_samples = session.exec(
        select(AgentRun)
        .where(AgentRun.org_id == org_id, AgentRun.status == "cancelled", AgentRun.started_at >= cutoff_iso)
        .order_by(AgentRun.started_at.desc())
        .limit(queue_limit)
    ).all()
    sample_rows = [*blocked_samples, *failed_samples, *stale_samples, *cancelled_samples]
    agent_ids = sorted({agent_id for agent_id, _, _ in count_rows} | {run.agent_id for run in sample_rows})
    agents = session.exec(select(Agent).where(Agent.org_id == org_id, Agent.id.in_(agent_ids))).all() if agent_ids else []
    agent_names = {agent.id: agent.name for agent in agents}
    queues: dict[str, list[RunIncidentItemRead]] = {"blocked": [], "failed": [], "stale": [], "cancelled": []}
    queue_counts: dict[str, int] = {"blocked": 0, "failed": 0, "stale": 0, "cancelled": 0}
    agent_totals: dict[str, RunIncidentAgentRead] = {}

    for agent_id, run_status, count in count_rows:
        queue_key = "stale" if run_status == "running" else str(run_status)
        if queue_key not in queue_counts:
            continue
        count_value = int(count or 0)
        queue_counts[queue_key] += count_value
        agent_total = agent_totals.setdefault(
            str(agent_id),
            RunIncidentAgentRead(agent_id=str(agent_id), agent_name=agent_names.get(str(agent_id), "")),
        )
        setattr(agent_total, queue_key, getattr(agent_total, queue_key) + count_value)
        agent_total.total += count_value

    for run in sample_rows:
        queue_key = "stale" if run.status in {"stale", "running"} else run.status
        if queue_key in queues and len(queues[queue_key]) < queue_limit:
            queues[queue_key].append(_run_incident_item(run, agent_names.get(run.agent_id, ""), current_time, session))

    queue_reads = [
        RunIncidentQueueRead(
            key=key,
            label=str(meta["label"]),
            severity=str(meta["severity"]),
            count=queue_counts[key],
            items=queues[key],
        )
        for key, meta in INCIDENT_QUEUE_META.items()
    ]
    return RunIncidentSummaryRead(
        total=sum(queue.count for queue in queue_reads),
        window_minutes=window_minutes,
        stale_threshold_minutes=stale_threshold_minutes,
        generated_at=now_iso(),
        queues=queue_reads,
        by_agent=sorted(agent_totals.values(), key=lambda item: item.total, reverse=True)[:10],
    )


@router.post("/maintenance/mark-stale", response_model=List[AgentRunRead])
def mark_stale_agent_runs(
    older_than_minutes: int = 120,
    limit: int = 100,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> List[AgentRunRead]:
    rows = mark_stale_runs(
        session,
        org_id=context.organization.id,
        older_than_minutes=older_than_minutes,
        limit=limit,
    )
    return [_to_read(run, session) for run in rows]


@router.get("/{run_id}", response_model=AgentRunRead)
def get_run(
    run_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AgentRunRead:
    run = get_run_or_404(session, run_id, context.organization.id)
    return _to_read(run, session)


@router.get("/{run_id}/events", response_model=List[RunTraceEvent])
def list_run_events(
    run_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[RunTraceEvent]:
    return [RunTraceEvent(**event) for event in read_run_events(session, get_run_or_404(session, run_id, context.organization.id))]


@router.get("/{run_id}/evidence", response_model=RunEvidenceRead)
def get_run_evidence(
    run_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> RunEvidenceRead:
    run = get_run_or_404(session, run_id, context.organization.id)
    org_id = context.organization.id
    return RunEvidenceRead(
        run=_to_read(run, session),
        replay_request=_replay_request(run),
        runtime_snapshot=_runtime_snapshot(run),
        llm_logs=list_llm_invocation_logs(session, org_id=org_id, run_id=run.id, limit=100),
        tool_audits=list_tool_audits(session, org_id, run_id=run.id, limit=100),
        knowledge_audits=list_knowledge_retrieval_audits(session, org_id=org_id, run_id=run.id, limit=100),
    )


@router.get("/{run_id}/recovery", response_model=RunRecoveryRead)
def get_run_recovery(
    run_id: str,
    limit: int = 5,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> RunRecoveryRead:
    org_id = context.organization.id
    limit = min(max(limit, 1), 20)
    selected_run = get_run_or_404(session, run_id, org_id)
    source_run = selected_run
    if selected_run.rerun_of_run_id:
        source_run = get_run_or_404(session, selected_run.rerun_of_run_id, org_id)

    candidates = session.exec(
        select(AgentRun)
        .where(AgentRun.org_id == org_id, AgentRun.rerun_of_run_id == source_run.id)
        .order_by(AgentRun.started_at.desc())
        .limit(limit)
    ).all()
    latest_rerun = candidates[0] if candidates else None
    agent = session.get(Agent, source_run.agent_id)
    agent_name = agent.name if agent and agent.org_id == org_id else ""
    source_snapshot = _recovery_snapshot(source_run, agent_name)
    candidate_snapshots = [
        _recovery_snapshot(run, agent_name)
        for run in candidates
    ]
    latest_snapshot = candidate_snapshots[0] if candidate_snapshots else None
    status, verdict = _recovery_status(source_run, latest_rerun)
    return RunRecoveryRead(
        source_run=source_snapshot,
        latest_rerun=latest_snapshot,
        rerun_count=_derived_run_count(source_run, session),
        status=status,
        verdict=verdict,
        deltas=_recovery_delta(source_snapshot, latest_snapshot),
        candidates=candidate_snapshots,
    )


@router.post("/{run_id}/test-case", response_model=AgentTestCaseRead)
def create_test_case_from_run(
    run_id: str,
    payload: RunToTestCaseRequest | None = None,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentTestCaseRead:
    org_id = context.organization.id
    run = get_run_or_404(session, run_id, org_id)
    get_agent_or_404(session, run.agent_id, org_id)
    input_text = run.input_text or run.input_preview
    if not input_text.strip():
        raise HTTPException(status_code=400, detail="该运行没有可留存为验收用例的输入")

    payload = payload or RunToTestCaseRequest()
    output_text = run.output_text or run.output_preview
    expected_keywords = payload.expected_keywords if payload.expected_keywords is not None else _suggest_keywords(output_text)
    expected_keywords = [keyword.strip() for keyword in expected_keywords if keyword.strip()]
    max_duration_ms = payload.max_duration_ms or (run.duration_ms * 2 if run.duration_ms > 0 else None)
    assertion = {
        "required_keywords": expected_keywords,
        "required_tools": [],
        "required_subagents": [],
        "required_event_types": [],
        "required_json_schema": {},
        "source_run_id": run.id,
        "source_run_status": run.status,
        "source_run_model": run.model,
        "source_run_spec_hash": run.spec_hash,
    }
    if max_duration_ms:
        assertion["max_duration_ms"] = max_duration_ms
    case_name = payload.name or f"验收：{run.input_preview or input_text[:32]}"
    row = AgentTestCase(
        id=new_id("case"),
        org_id=org_id,
        agent_id=run.agent_id,
        name=_clip_text(case_name, 80),
        input_text=input_text,
        expected_keywords_json=_dumps(expected_keywords),
        assertion_json=_dumps(assertion),
        status="active",
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _test_case_to_read(row)


@router.post("/{run_id}/cancel", response_model=AgentRunRead)
def cancel_agent_run(
    run_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentRunRead:
    run = get_run_or_404(session, run_id, context.organization.id)
    return _to_read(cancel_run(session, run, reason=f"由 {context.user.email} 取消运行"), session)


@router.get("/{run_id}/knowledge-audits", response_model=List[KnowledgeRetrievalAuditRead])
def list_run_knowledge_audits(
    run_id: str,
    limit: int = 50,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[KnowledgeRetrievalAuditRead]:
    run = get_run_or_404(session, run_id, context.organization.id)
    return list_knowledge_retrieval_audits(
        session,
        org_id=context.organization.id,
        run_id=run.id,
        limit=limit,
    )


@router.get("/{run_id}/llm-logs", response_model=List[LLMInvocationLogRead])
def list_run_llm_logs(
    run_id: str,
    limit: int = 50,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[LLMInvocationLogRead]:
    run = get_run_or_404(session, run_id, context.organization.id)
    return list_llm_invocation_logs(
        session,
        org_id=context.organization.id,
        run_id=run.id,
        limit=limit,
    )


def _latest_rerun(session: Session, agent_id: str, conversation_id: str, org_id: str) -> AgentRun | None:
    return session.exec(
        select(AgentRun)
        .where(AgentRun.agent_id == agent_id, AgentRun.conversation_id == conversation_id, AgentRun.org_id == org_id)
        .order_by(AgentRun.started_at.desc())
        .limit(1)
    ).first()


@router.post("/{run_id}/rerun", response_model=AgentRunRead)
async def rerun(
    run_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentRunRead:
    org_id = context.organization.id
    source_run = get_run_or_404(session, run_id, org_id)
    agent = get_agent_or_404(session, source_run.agent_id, org_id)
    input_text = source_run.input_text or source_run.input_preview
    if not input_text:
        raise HTTPException(status_code=400, detail="该运行没有可重跑的输入")
    try:
        runtime_plan = build_run_snapshot_runtime_plan(agent, source_run)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    conversation_id = f"rerun:{source_run.id}:{new_id('runctx')}"
    service = AgentExecutionService(
        session,
        org_id=org_id,
        actor_role=context.membership.role,
        actor_user_id=context.user.id,
    )
    try:
        request = responses_to_execution(
            session,
            org_id,
            ResponsesRequest(
                model=f"agent:{agent.id}",
                input=input_text,
                metadata={"conversation_id": conversation_id},
            ),
        )
        await ExecutionGateway(service).execute_once(
            request,
            ExecutionGatewayOptions(
                source="rerun",
                entrypoint="responses",
                trace_label="运行重跑",
                done_label="重跑完成",
                error_label="重跑失败",
                rerun_of_run_id=source_run.id,
                runtime_plan_override=runtime_plan,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"重跑失败: {exc}") from exc

    new_run = _latest_rerun(session, agent.id, conversation_id, org_id)
    if not new_run:
        raise HTTPException(status_code=500, detail="重跑已触发但未生成运行证据")
    return _to_read(new_run, session)
