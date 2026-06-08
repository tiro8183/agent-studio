from collections.abc import Iterable, Mapping


def unique_resource_ids(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(item for item in values if item))


def tool_ids_for_runtime(
    configured_tools: list[str],
    skill_ids: list[str],
    skill_allowed_tools: Mapping[str, Iterable[str]],
) -> list[str]:
    skill_tool_ids = [
        tool_id
        for skill_id in skill_ids
        for tool_id in skill_allowed_tools.get(skill_id, [])
    ]
    return unique_resource_ids([*configured_tools, *skill_tool_ids])
