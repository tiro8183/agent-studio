from datetime import datetime, timedelta, timezone
from time import perf_counter
from sqlmodel import Session, select

from app.core.models import AgentRun, now_iso
from app.services.run_event_service import append_run_events
from app.services.run_trace_service import trace_event

TERMINAL_RUN_STATUSES = {"completed", "failed", "cancelled", "stale", "blocked"}


class RunCancelledError(RuntimeError):
    pass


def is_terminal_run_status(status: str) -> bool:
    return status in TERMINAL_RUN_STATUSES


def cancel_run(session: Session, run: AgentRun, *, reason: str = "用户取消运行") -> AgentRun:
    if is_terminal_run_status(run.status):
        return run
    started = _perf_started_for_run(run)
    run.status = "cancelled"
    run.error = reason[:500]
    run.ended_at = now_iso()
    run.duration_ms = _duration_ms(run)
    append_run_events(session, run, [trace_event("cancelled", "运行已取消", started, output_preview=reason, status="error")])
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def ensure_run_not_cancelled(session: Session, run: AgentRun) -> None:
    session.refresh(run)
    if run.status == "cancelled":
        raise RunCancelledError(run.error or "运行已取消")


def mark_stale_runs(session: Session, *, org_id: str, older_than_minutes: int = 120, limit: int = 100) -> list[AgentRun]:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max(older_than_minutes, 1))
    rows = session.exec(
        select(AgentRun)
        .where(AgentRun.org_id == org_id, AgentRun.status == "running")
        .order_by(AgentRun.started_at.asc())
        .limit(min(max(limit, 1), 500))
    ).all()
    stale_runs: list[AgentRun] = []
    for run in rows:
        started_at = _parse_datetime(run.started_at)
        if not started_at or started_at > cutoff:
            continue
        started = _perf_started_for_run(run)
        run.status = "stale"
        run.error = f"运行超过 {older_than_minutes} 分钟未结束，已标记为失联。"
        run.ended_at = now_iso()
        run.duration_ms = _duration_ms(run)
        append_run_events(session, run, [trace_event("stale", "运行已标记为失联", started, output_preview=run.error, status="error")])
        session.add(run)
        stale_runs.append(run)
    if stale_runs:
        session.commit()
        for run in stale_runs:
            session.refresh(run)
    return stale_runs


def _duration_ms(run: AgentRun) -> int:
    started_at = _parse_datetime(run.started_at)
    if not started_at:
        return run.duration_ms
    ended_at = _parse_datetime(run.ended_at) or datetime.now(timezone.utc)
    return max(int((ended_at - started_at).total_seconds() * 1000), run.duration_ms or 0)


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _perf_started_for_run(run: AgentRun) -> float:
    return perf_counter() - max((run.duration_ms or 0) / 1000, 0)
