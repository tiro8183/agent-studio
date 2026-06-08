from dataclasses import dataclass

from sqlmodel import Session, func, select

from app.core.models import Agent, AgentReleaseSnapshot, AgentRun, LLMInvocationLog
from app.services.mappers import _loads


@dataclass(frozen=True)
class LLMDeletionUsage:
    agent_refs: int = 0
    subagent_refs: int = 0
    release_refs: int = 0
    run_refs: int = 0
    invocation_logs: int = 0

    @property
    def total(self) -> int:
        return self.agent_refs + self.subagent_refs + self.release_refs + self.run_refs + self.invocation_logs


def llm_deletion_usage(config_id: str, session: Session, org_id: str) -> LLMDeletionUsage:
    agent_refs = int(
        session.exec(
            select(func.count())
            .select_from(Agent)
            .where(Agent.llm_config_id == config_id, Agent.org_id == org_id)
        ).one()
        or 0
    )
    subagent_refs = _subagent_llm_reference_count(session, config_id, org_id)
    release_refs = _release_llm_reference_count(session, config_id, org_id)
    run_refs = _run_llm_reference_count(session, config_id, org_id)
    invocation_logs = int(
        session.exec(
            select(func.count())
            .select_from(LLMInvocationLog)
            .where(LLMInvocationLog.llm_config_id == config_id, LLMInvocationLog.org_id == org_id)
        ).one()
        or 0
    )
    return LLMDeletionUsage(
        agent_refs=agent_refs,
        subagent_refs=subagent_refs,
        release_refs=release_refs,
        run_refs=run_refs,
        invocation_logs=invocation_logs,
    )


def llm_deletion_usage_detail(usage: LLMDeletionUsage) -> str:
    return (
        f"该模型通道仍被 {usage.agent_refs} 个 Agent、{usage.subagent_refs} 个协作角色、"
        f"{usage.release_refs} 个上线版本、{usage.run_refs} 条存量运行和 "
        f"{usage.invocation_logs} 条 LLM 调用日志引用"
    )


def _subagent_llm_reference_count(session: Session, config_id: str, org_id: str) -> int:
    count = 0
    for agent in session.exec(select(Agent).where(Agent.org_id == org_id)).all():
        subagents = _loads(agent.subagents_json, [])
        if not isinstance(subagents, list):
            continue
        for subagent in subagents:
            if isinstance(subagent, dict) and str(subagent.get("llm_config_id") or "") == config_id:
                count += 1
    return count


def _release_llm_reference_count(session: Session, config_id: str, org_id: str) -> int:
    count = 0
    for release in session.exec(
        select(AgentReleaseSnapshot).where(AgentReleaseSnapshot.org_id == org_id)
    ).all():
        if _runtime_spec_references_llm(_loads(release.runtime_spec_json, {}), config_id):
            count += 1
    return count


def _run_llm_reference_count(session: Session, config_id: str, org_id: str) -> int:
    count = 0
    for run in session.exec(select(AgentRun).where(AgentRun.org_id == org_id)).all():
        if _runtime_spec_references_llm(_loads(run.runtime_spec_json, {}), config_id):
            count += 1
    return count


def _runtime_spec_references_llm(runtime_spec: dict, config_id: str) -> bool:
    agent_spec = runtime_spec.get("agent") or {}
    if str(agent_spec.get("llm_config_id") or "") == config_id:
        return True
    for subagent in agent_spec.get("subagents") or []:
        if isinstance(subagent, dict) and str(subagent.get("llm_config_id") or "") == config_id:
            return True
    for item in runtime_spec.get("llm_configs") or []:
        if isinstance(item, dict) and str(item.get("id") or item.get("llm_config_id") or "") == config_id:
            return True
    return False
