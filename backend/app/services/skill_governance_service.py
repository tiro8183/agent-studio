from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, select

from app.core.models import Agent, AgentReleaseSnapshot, AgentRun
from app.services.mappers import _loads


@dataclass(frozen=True)
class SkillDeletionUsage:
    agent_refs: int = 0
    release_refs: int = 0
    run_refs: int = 0

    @property
    def total(self) -> int:
        return self.agent_refs + self.release_refs + self.run_refs


def skill_deletion_usage(skill_id: str, session: Session, org_id: str) -> SkillDeletionUsage:
    return SkillDeletionUsage(
        agent_refs=_agent_skill_reference_count(session, skill_id, org_id),
        release_refs=_release_skill_reference_count(session, skill_id, org_id),
        run_refs=_run_skill_reference_count(session, skill_id, org_id),
    )


def skill_deletion_usage_detail(usage: SkillDeletionUsage) -> str:
    return (
        f"能力仍被 {usage.agent_refs} 项服务、"
        f"{usage.release_refs} 个上线版本和 {usage.run_refs} 条存量运行引用"
    )


def _agent_skill_reference_count(session: Session, skill_id: str, org_id: str) -> int:
    count = 0
    for agent in session.exec(select(Agent).where(Agent.org_id == org_id)).all():
        if _agent_spec_references_skill(
            {
                "skills": _loads(agent.skills_json, []),
                "subagents": _loads(agent.subagents_json, []),
            },
            skill_id,
        ):
            count += 1
    return count


def _release_skill_reference_count(session: Session, skill_id: str, org_id: str) -> int:
    count = 0
    for release in session.exec(select(AgentReleaseSnapshot).where(AgentReleaseSnapshot.org_id == org_id)).all():
        if _runtime_spec_references_skill(_loads(release.runtime_spec_json, {}), skill_id):
            count += 1
    return count


def _run_skill_reference_count(session: Session, skill_id: str, org_id: str) -> int:
    count = 0
    for run in session.exec(select(AgentRun).where(AgentRun.org_id == org_id)).all():
        if _runtime_spec_references_skill(_loads(run.runtime_spec_json, {}), skill_id):
            count += 1
    return count


def _runtime_spec_references_skill(runtime_spec: dict[str, Any], skill_id: str) -> bool:
    if not isinstance(runtime_spec, dict):
        return False
    if _skill_ids_include(runtime_spec.get("skills") or [], skill_id):
        return True
    agent_spec = runtime_spec.get("agent") or {}
    return isinstance(agent_spec, dict) and _agent_spec_references_skill(agent_spec, skill_id)


def _agent_spec_references_skill(agent_spec: dict[str, Any], skill_id: str) -> bool:
    if _skill_ids_include(agent_spec.get("skills") or [], skill_id):
        return True
    for subagent in agent_spec.get("subagents") or []:
        if isinstance(subagent, dict) and _skill_ids_include(subagent.get("skills") or [], skill_id):
            return True
    return False


def _skill_ids_include(items: Any, skill_id: str) -> bool:
    if not isinstance(items, list):
        return False
    return any(_skill_item_matches(item, skill_id) for item in items)


def _skill_item_matches(item: Any, skill_id: str) -> bool:
    if isinstance(item, dict):
        return str(item.get("id") or item.get("skill_id") or "") == skill_id
    return str(item) == skill_id
