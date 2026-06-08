from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func
from sqlmodel import Session, select

from app.core.models import AgentRun, AgentTestCase, AgentTestRun, KnowledgeRetrievalAudit, LLMInvocationLog, RunEvent, ToolInvocationAudit


BATCH_SIZE = 500


@dataclass(frozen=True)
class RunRetentionPolicy:
    retain_days: int = 30
    retain_minimum: int = 200
    include_running: bool = False

    def __post_init__(self) -> None:
        if self.retain_days < 1:
            raise ValueError("retain_days must be greater than 0")
        if self.retain_minimum < 0:
            raise ValueError("retain_minimum must be greater than or equal to 0")


@dataclass(frozen=True)
class RunRetentionCandidate:
    id: str
    agent_id: str
    status: str
    started_at: str
    ended_at: str | None


@dataclass(frozen=True)
class RunRetentionResult:
    policy: RunRetentionPolicy
    total_runs: int
    eligible_runs: int
    retained_runs: int
    deleted_runs: int
    protected_test_runs: int
    protected_minimum_runs: int
    protected_running_runs: int
    deleted_llm_logs: int
    deleted_tool_audits: int
    deleted_knowledge_audits: int
    deleted_run_events: int
    cleared_rerun_links: int
    cutoff_at: str
    dry_run: bool
    candidate_run_ids: list[str] = field(default_factory=list)
    candidate_runs: list[RunRetentionCandidate] = field(default_factory=list)


def preview_run_retention(session: Session, org_id: str, policy: RunRetentionPolicy) -> RunRetentionResult:
    return _evaluate_run_retention(session, org_id, policy, dry_run=True)


def apply_run_retention(session: Session, org_id: str, policy: RunRetentionPolicy) -> RunRetentionResult:
    result = _evaluate_run_retention(session, org_id, policy, dry_run=False)
    if not result.candidate_runs:
        return result

    if result.candidate_run_ids:
        candidate_id_set = set(result.candidate_run_ids)
        for batch in _batched(result.candidate_run_ids):
            session.exec(
                delete(LLMInvocationLog).where(
                    LLMInvocationLog.org_id == org_id,
                    LLMInvocationLog.run_id.in_(batch),
                )
            )
            session.exec(
                delete(ToolInvocationAudit).where(
                    ToolInvocationAudit.org_id == org_id,
                    ToolInvocationAudit.run_id.in_(batch),
                )
            )
            session.exec(
                delete(KnowledgeRetrievalAudit).where(
                    KnowledgeRetrievalAudit.org_id == org_id,
                    KnowledgeRetrievalAudit.run_id.in_(batch),
                )
            )
            session.exec(
                delete(RunEvent).where(
                    RunEvent.org_id == org_id,
                    RunEvent.run_id.in_(batch),
                )
            )
            derived_runs = session.exec(
                select(AgentRun).where(
                    AgentRun.org_id == org_id,
                    AgentRun.rerun_of_run_id.in_(batch),
                )
            ).all()
            for run in derived_runs:
                if run.id in candidate_id_set:
                    continue
                run.rerun_of_run_id = None
                session.add(run)
            rows = session.exec(
                select(AgentRun).where(
                    AgentRun.org_id == org_id,
                    AgentRun.id.in_(batch),
                )
            ).all()
            for row in rows:
                session.delete(row)
        session.commit()
    return result


def _evaluate_run_retention(
    session: Session,
    org_id: str,
    policy: RunRetentionPolicy,
    dry_run: bool,
) -> RunRetentionResult:
    cutoff = datetime.now(timezone.utc) - timedelta(days=policy.retain_days)
    cutoff_at = cutoff.isoformat()
    runs = session.exec(
        select(AgentRun)
        .where(AgentRun.org_id == org_id)
        .order_by(AgentRun.started_at.desc())
    ).all()
    run_ids = {run.id for run in runs}
    protected_minimum_ids = {run.id for run in runs[:policy.retain_minimum]}
    protected_test_ids = _test_protected_run_ids(session, org_id) & run_ids
    protected_running = 0
    candidates: list[RunRetentionCandidate] = []

    for run in runs:
        if run.id in protected_minimum_ids or run.id in protected_test_ids:
            continue
        if run.status == "running" and not policy.include_running:
            protected_running += 1
            continue
        if not _is_older_than_cutoff(run, cutoff):
            continue
        candidates.append(
            RunRetentionCandidate(
                id=run.id,
                agent_id=run.agent_id,
                status=run.status,
                started_at=run.started_at,
                ended_at=run.ended_at,
            )
        )

    deleted_runs = 0 if dry_run else len(candidates)
    candidate_run_ids = [item.id for item in candidates]
    related_counts = _related_retention_counts(session, org_id, candidate_run_ids)
    return RunRetentionResult(
        policy=policy,
        total_runs=len(runs),
        eligible_runs=len(candidates),
        retained_runs=len(runs) - len(candidates),
        deleted_runs=deleted_runs,
        protected_test_runs=len(protected_test_ids),
        protected_minimum_runs=len(protected_minimum_ids),
        protected_running_runs=protected_running,
        deleted_llm_logs=related_counts.deleted_llm_logs,
        deleted_tool_audits=related_counts.deleted_tool_audits,
        deleted_knowledge_audits=related_counts.deleted_knowledge_audits,
        deleted_run_events=related_counts.deleted_run_events,
        cleared_rerun_links=related_counts.cleared_rerun_links,
        cutoff_at=cutoff_at,
        dry_run=dry_run,
        candidate_run_ids=candidate_run_ids,
        candidate_runs=candidates[:50],
    )


@dataclass(frozen=True)
class RelatedRetentionCounts:
    deleted_llm_logs: int = 0
    deleted_tool_audits: int = 0
    deleted_knowledge_audits: int = 0
    deleted_run_events: int = 0
    cleared_rerun_links: int = 0


def _related_retention_counts(session: Session, org_id: str, run_ids: list[str]) -> RelatedRetentionCounts:
    if not run_ids:
        return RelatedRetentionCounts()

    run_id_set = set(run_ids)
    deleted_llm_logs = 0
    deleted_tool_audits = 0
    deleted_knowledge_audits = 0
    deleted_run_events = 0
    cleared_rerun_links = 0
    for batch in _batched(run_ids):
        deleted_llm_logs += _count_rows(
            session,
            select(func.count()).select_from(LLMInvocationLog).where(
                LLMInvocationLog.org_id == org_id,
                LLMInvocationLog.run_id.in_(batch),
            ),
        )
        deleted_tool_audits += _count_rows(
            session,
            select(func.count()).select_from(ToolInvocationAudit).where(
                ToolInvocationAudit.org_id == org_id,
                ToolInvocationAudit.run_id.in_(batch),
            ),
        )
        deleted_knowledge_audits += _count_rows(
            session,
            select(func.count()).select_from(KnowledgeRetrievalAudit).where(
                KnowledgeRetrievalAudit.org_id == org_id,
                KnowledgeRetrievalAudit.run_id.in_(batch),
            ),
        )
        deleted_run_events += _count_rows(
            session,
            select(func.count()).select_from(RunEvent).where(
                RunEvent.org_id == org_id,
                RunEvent.run_id.in_(batch),
            ),
        )
        derived_runs = session.exec(
            select(AgentRun.id).where(
                AgentRun.org_id == org_id,
                AgentRun.rerun_of_run_id.in_(batch),
            ),
        ).all()
        cleared_rerun_links += sum(1 for run_id in derived_runs if run_id not in run_id_set)

    return RelatedRetentionCounts(
        deleted_llm_logs=deleted_llm_logs,
        deleted_tool_audits=deleted_tool_audits,
        deleted_knowledge_audits=deleted_knowledge_audits,
        deleted_run_events=deleted_run_events,
        cleared_rerun_links=cleared_rerun_links,
    )


def _count_rows(session: Session, stmt) -> int:
    return int(session.exec(stmt).one() or 0)


def _batched(items: list[str], size: int = BATCH_SIZE) -> list[list[str]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def _test_protected_run_ids(session: Session, org_id: str) -> set[str]:
    test_run_rows = session.exec(
        select(AgentTestRun.agent_run_id)
        .where(AgentTestRun.org_id == org_id, AgentTestRun.agent_run_id.is_not(None))
    ).all()
    case_rows = session.exec(
        select(AgentTestCase.last_run_id)
        .where(AgentTestCase.org_id == org_id, AgentTestCase.last_run_id.is_not(None))
    ).all()
    return {str(run_id) for run_id in [*test_run_rows, *case_rows] if run_id}


def _is_older_than_cutoff(run: AgentRun, cutoff: datetime) -> bool:
    value = run.ended_at or run.started_at
    parsed = _parse_iso_datetime(value)
    return bool(parsed and parsed < cutoff)


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
