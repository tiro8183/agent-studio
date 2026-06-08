from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class LLMUsageSummary:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    llm_calls: int = 0


@dataclass(frozen=True)
class LLMUsageBreakdown:
    model: str = ""
    subagent: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    llm_calls: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "subagent": self.subagent,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "llm_calls": self.llm_calls,
        }


def summarize_llm_usage(messages: Iterable[Any]) -> LLMUsageSummary:
    input_tokens = 0
    output_tokens = 0
    total_tokens = 0
    calls = 0
    for message in messages:
        if not _is_ai_message(message):
            continue
        usage = _message_usage(message)
        if not usage:
            continue
        calls += 1
        input_tokens += _usage_int(usage, "input_tokens", "prompt_tokens")
        output_tokens += _usage_int(usage, "output_tokens", "completion_tokens")
        total_tokens += _usage_int(usage, "total_tokens")
    if not total_tokens and (input_tokens or output_tokens):
        total_tokens = input_tokens + output_tokens
    return LLMUsageSummary(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        llm_calls=calls,
    )


def summarize_llm_usage_breakdown(messages: Iterable[Any]) -> list[LLMUsageBreakdown]:
    totals: dict[tuple[str, str], LLMUsageBreakdown] = {}
    for message in messages:
        if not _is_ai_message(message):
            continue
        usage = _message_usage(message)
        if not usage:
            continue
        model = _message_model(message)
        subagent = str(getattr(message, "name", None) or "")
        key = (model, subagent)
        current = totals.get(key, LLMUsageBreakdown(model=model, subagent=subagent))
        input_tokens = _usage_int(usage, "input_tokens", "prompt_tokens")
        output_tokens = _usage_int(usage, "output_tokens", "completion_tokens")
        total_tokens = _usage_int(usage, "total_tokens") or input_tokens + output_tokens
        totals[key] = LLMUsageBreakdown(
            model=model,
            subagent=subagent,
            input_tokens=current.input_tokens + input_tokens,
            output_tokens=current.output_tokens + output_tokens,
            total_tokens=current.total_tokens + total_tokens,
            llm_calls=current.llm_calls + 1,
        )
    return sorted(
        totals.values(),
        key=lambda item: (item.subagent != "", item.subagent, item.model),
    )


def _is_ai_message(message: Any) -> bool:
    return hasattr(message, "usage_metadata") or hasattr(message, "response_metadata")


def _message_usage(message: Any) -> dict[str, Any]:
    usage_metadata = getattr(message, "usage_metadata", None)
    if isinstance(usage_metadata, dict) and usage_metadata:
        return usage_metadata
    response_metadata = getattr(message, "response_metadata", None)
    if isinstance(response_metadata, dict):
        token_usage = response_metadata.get("token_usage") or response_metadata.get("usage")
        if isinstance(token_usage, dict):
            return token_usage
    return {}


def _message_model(message: Any) -> str:
    response_metadata = getattr(message, "response_metadata", None)
    if isinstance(response_metadata, dict):
        for key in ("model_name", "model", "model_id"):
            value = response_metadata.get(key)
            if value:
                return str(value)
    return ""


def _usage_int(usage: dict[str, Any], *keys: str) -> int:
    for key in keys:
        value = usage.get(key)
        if value is None:
            continue
        try:
            return max(int(value), 0)
        except (TypeError, ValueError):
            continue
    return 0
