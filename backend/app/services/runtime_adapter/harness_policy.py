from typing import Any

from deepagents._tools import _apply_tool_description_overrides
from deepagents.middleware._tool_exclusion import _ToolExclusionMiddleware


def harness_excluded(harness: dict[str, Any]) -> set[str]:
    excluded = {str(item) for item in (harness.get("excluded_tools") or []) if item}
    if harness.get("disable_general_purpose_subagent"):
        excluded.add("task")
    return excluded


def harness_overrides(harness: dict[str, Any]) -> dict[str, str]:
    overrides = harness.get("tool_description_overrides") or {}
    return {str(key): str(value) for key, value in overrides.items()} if isinstance(overrides, dict) else {}


def harness_disable_general_purpose(harness: dict[str, Any]) -> bool:
    return bool(harness.get("disable_general_purpose_subagent"))


def harness_middleware(harness: dict[str, Any]) -> list:
    excluded = harness_excluded(harness)
    return [_ToolExclusionMiddleware(excluded=frozenset(excluded))] if excluded else []


def apply_harness_tool_descriptions(tools: list, harness: dict[str, Any]) -> list:
    return _apply_tool_description_overrides(tools, harness_overrides(harness)) or []
