from time import perf_counter
from typing import Any

from app.core.models import now_iso


TRACE_PHASE_BY_TYPE = {
    "run_started": "setup",
    "model_invoked": "setup",
    "run_completed": "complete",
    "run_blocked": "error",
    "start": "setup",
    "model": "setup",
    "skills": "setup",
    "memory": "setup",
    "knowledge": "setup",
    "knowledge_retrieval": "setup",
    "llm_contracts": "setup",
    "llm_usage": "output",
    "fixed_reply": "complete",
    "test_case": "setup",
    "test_case_preview": "setup",
    "test_case_release": "setup",
    "tool_called": "tool",
    "tool_call": "tool",
    "tool_result": "tool",
    "subagent": "subagent",
    "subagent_result": "subagent",
    "first_token": "output",
    "done": "complete",
    "error": "error",
    "cancelled": "error",
    "stale": "error",
}
TRACE_STATUS_BY_TYPE = {
    "run_completed": "success",
    "run_blocked": "error",
    "tool_called": "running",
    "tool_call": "running",
    "subagent": "running",
    "subagent_result": "success",
    "tool_result": "success",
    "done": "success",
    "error": "error",
    "cancelled": "error",
    "stale": "error",
    "fixed_reply": "success",
}
TRACE_PHASES = {"setup", "reasoning", "tool", "subagent", "output", "complete", "error"}
TRACE_STATUSES = {"pending", "running", "success", "error", "info"}


def elapsed_ms(started: float) -> int:
    return int((perf_counter() - started) * 1000)


def trace_event(
    event_type: str,
    label: str,
    started: float,
    **extra: Any,
) -> dict[str, Any]:
    phase = extra.pop("phase", TRACE_PHASE_BY_TYPE.get(event_type, "reasoning"))
    status = extra.pop("status", TRACE_STATUS_BY_TYPE.get(event_type, "info"))
    return {
        "type": event_type,
        "phase": _coerce_phase(phase),
        "label": label,
        "status": _coerce_status(status),
        "timestamp": now_iso(),
        "elapsed_ms": elapsed_ms(started),
        **extra,
    }


def normalize_trace_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    calls_by_id: dict[str, dict[str, Any]] = {}
    for index, event in enumerate(events):
        event_type = str(event.get("type") or "event")
        label = str(event.get("label") or event_type)
        phase = event.get("phase") or TRACE_PHASE_BY_TYPE.get(event_type, "reasoning")
        status = event.get("status") or TRACE_STATUS_BY_TYPE.get(event_type, "info")
        seq = _coerce_int(event.get("seq"), index + 1)
        elapsed = _coerce_int(event.get("elapsed_ms"), 0)
        call_id = event.get("call_id")
        step_id = str(event.get("step_id") or call_id or f"event-{seq}")
        parent_seq = _coerce_optional_int(event.get("parent_seq"))
        duration = _coerce_int(event.get("duration_ms"), 0)
        if call_id:
            call_key = str(call_id)
            if event_type in {"tool_called", "tool_call", "subagent"}:
                calls_by_id[call_key] = {"seq": seq, "elapsed_ms": elapsed}
            elif event_type in {"tool_result", "subagent_result"} and call_key in calls_by_id:
                parent = calls_by_id[call_key]
                parent_seq = parent["seq"]
                if not duration and elapsed >= parent["elapsed_ms"]:
                    duration = elapsed - parent["elapsed_ms"]
        normalized.append({
            "seq": seq,
            "step_id": step_id,
            "parent_seq": parent_seq,
            "phase": _coerce_phase(phase),
            "type": event_type,
            "label": label,
            "status": _coerce_status(status),
            "timestamp": str(event.get("timestamp") or ""),
            "elapsed_ms": elapsed,
            "duration_ms": duration,
            "resource": event.get("resource") or event.get("tool"),
            "call_id": event.get("call_id"),
            "subagent": event.get("subagent"),
            "task": event.get("task"),
            "input_preview": str(event.get("input_preview") or ""),
            "output_preview": str(event.get("output_preview") or ""),
            "metadata": event.get("metadata") or {},
            "input": event.get("input"),
            "output": event.get("output"),
        })
    return normalized


def _coerce_phase(value: Any) -> str:
    text = str(value or "reasoning")
    return text if text in TRACE_PHASES else "reasoning"


def _coerce_status(value: Any) -> str:
    text = str(value or "info")
    return text if text in TRACE_STATUSES else "info"


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
