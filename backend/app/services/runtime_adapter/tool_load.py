from typing import Any

from sqlmodel import Session

from app.core.models import Agent
from app.services.runtime_adapter.compiled_plan import CompiledRuntimePlan
from app.services.tool_registry import (
    ToolInvocationContext,
    load_tools_for_runtime_scope,
    load_tools_for_runtime_snapshot,
)


def tool_snapshots_from_plan(plan: CompiledRuntimePlan) -> list[dict[str, Any]]:
    snapshots = _resource_snapshots(plan.main_tools)
    for subagent in plan.subagents:
        snapshots.extend(_resource_snapshots(list(subagent.get("tools") or [])))
    unique: dict[str, dict[str, Any]] = {}
    for snapshot in snapshots:
        snapshot_id = str(snapshot.get("id") or "")
        if snapshot_id and snapshot_id not in unique:
            unique[snapshot_id] = snapshot
    return list(unique.values())


def runtime_tool_loader(
    *,
    agent: Agent,
    session: Session | None,
    actor_role: str,
    tool_snapshots: list[dict[str, Any]] | None,
    tool_invocation_context: ToolInvocationContext | None,
):
    async def load_runtime_tools(tool_ids: list[str]) -> list:
        context = tool_invocation_context or ToolInvocationContext(
            actor_role=actor_role,
            source="runtime",
            agent_id=agent.id,
        )
        if tool_snapshots is None:
            return await load_tools_for_runtime_scope(
                tool_ids,
                session,
                agent.org_id,
                actor_role=actor_role,
                invocation_context=context,
            )
        return await load_tools_for_runtime_snapshot(
            tool_ids,
            tool_snapshots,
            session,
            org_id=agent.org_id,
            actor_role=actor_role,
            invocation_context=context,
        )

    return load_runtime_tools


def _resource_snapshots(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = []
    for resource in resources:
        metadata = resource.get("metadata") or {}
        if not isinstance(metadata, dict):
            continue
        snapshot = metadata.get("snapshot")
        if isinstance(snapshot, dict):
            snapshots.append(snapshot)
    return snapshots
