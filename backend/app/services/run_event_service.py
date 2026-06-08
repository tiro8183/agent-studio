import json
from typing import Any, Iterable

from sqlmodel import Session, delete, select

from app.core.models import AgentRun, RunEvent, new_id, now_iso
from app.services.run_trace_service import normalize_trace_events


def read_run_events(session: Session, run: AgentRun) -> list[dict[str, Any]]:
    rows = _select_run_event_rows(session, run)
    return normalize_trace_events([_event_row_to_dict(row) for row in rows])


def write_run_events(
    session: Session,
    run: AgentRun,
    events: Iterable[dict[str, Any]],
    *,
    commit: bool = False,
) -> list[dict[str, Any]]:
    normalized = normalize_trace_events(list(events))
    session.add(run)
    _replace_run_event_rows(session, run, normalized)
    if commit:
        session.commit()
    return normalized


def append_run_events(
    session: Session,
    run: AgentRun,
    events: Iterable[dict[str, Any]],
    *,
    commit: bool = False,
) -> list[dict[str, Any]]:
    merged = [*read_run_events(session, run), *list(events)]
    return write_run_events(session, run, merged, commit=commit)


def _select_run_event_rows(session: Session, run: AgentRun) -> list[RunEvent]:
    return list(
        session.exec(
            select(RunEvent)
            .where(RunEvent.org_id == run.org_id, RunEvent.run_id == run.id)
            .order_by(RunEvent.seq.asc())
        ).all()
    )


def _replace_run_event_rows(session: Session, run: AgentRun, events: list[dict[str, Any]]) -> None:
    session.exec(delete(RunEvent).where(RunEvent.org_id == run.org_id, RunEvent.run_id == run.id))
    for event in events:
        session.add(_event_dict_to_row(run, event))


def _event_dict_to_row(run: AgentRun, event: dict[str, Any]) -> RunEvent:
    return RunEvent(
        id=new_id("evt"),
        org_id=run.org_id,
        agent_id=run.agent_id,
        run_id=run.id,
        seq=int(event.get("seq") or 0),
        step_id=str(event.get("step_id") or ""),
        parent_seq=_optional_int(event.get("parent_seq")),
        phase=str(event.get("phase") or "reasoning"),
        type=str(event.get("type") or "event"),
        label=str(event.get("label") or ""),
        status=str(event.get("status") or "info"),
        timestamp=str(event.get("timestamp") or ""),
        elapsed_ms=int(event.get("elapsed_ms") or 0),
        duration_ms=int(event.get("duration_ms") or 0),
        resource=_optional_str(event.get("resource")),
        call_id=_optional_str(event.get("call_id")),
        subagent=_optional_str(event.get("subagent")),
        task=_optional_str(event.get("task")),
        input_preview=str(event.get("input_preview") or ""),
        output_preview=str(event.get("output_preview") or ""),
        metadata_json=_json_dumps(event.get("metadata") or {}),
        input_json=_json_dumps(event.get("input")),
        output_json=_json_dumps(event.get("output")),
        created_at=str(event.get("timestamp") or now_iso()),
    )


def _event_row_to_dict(row: RunEvent) -> dict[str, Any]:
    return {
        "seq": row.seq,
        "step_id": row.step_id,
        "parent_seq": row.parent_seq,
        "phase": row.phase,
        "type": row.type,
        "label": row.label,
        "status": row.status,
        "timestamp": row.timestamp or row.created_at,
        "elapsed_ms": row.elapsed_ms,
        "duration_ms": row.duration_ms,
        "resource": row.resource,
        "call_id": row.call_id,
        "subagent": row.subagent,
        "task": row.task,
        "input_preview": row.input_preview,
        "output_preview": row.output_preview,
        "metadata": _json_loads(row.metadata_json, {}),
        "input": _json_loads(row.input_json, None),
        "output": _json_loads(row.output_json, None),
    }


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_loads(value: str, default: Any) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _optional_str(value: Any) -> str | None:
    if value is None or value == "":
        return None
    return str(value)


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
