from sqlalchemy import func
from sqlmodel import Session, select

from app.core.models import Agent, AgentRun
from app.core.schemas import AgentRunRead
from app.services.mappers import _loads
from app.services.run_event_service import read_run_events
from app.services.runtime_plan_service import build_run_snapshot_runtime_plan


def derived_run_count(run: AgentRun, session: Session) -> int:
    count = session.exec(
        select(func.count())
        .select_from(AgentRun)
        .where(AgentRun.org_id == run.org_id, AgentRun.rerun_of_run_id == run.id)
    ).one()
    return int(count or 0)


def agent_run_to_read(run: AgentRun, session: Session) -> AgentRunRead:
    tools = _loads(run.tools_json, [])
    subagents = _loads(run.subagents_json, [])
    agent = session.get(Agent, run.agent_id)
    agent_name = agent.name if agent and agent.org_id == run.org_id else ""
    runtime_manifest = None
    manifest_hash = ""
    if agent and agent.org_id == run.org_id:
        try:
            runtime_plan = build_run_snapshot_runtime_plan(agent, run)
            runtime_manifest = runtime_plan.runtime_manifest
            manifest_hash = runtime_plan.manifest_hash
        except ValueError:
            runtime_manifest = None
    return AgentRunRead(
        id=run.id,
        org_id=run.org_id,
        agent_id=run.agent_id,
        agent_name=agent_name,
        conversation_id=run.conversation_id,
        rerun_of_run_id=run.rerun_of_run_id,
        derived_run_count=derived_run_count(run, session),
        release_id=run.release_id,
        agent_version=run.agent_version,
        spec_hash=run.spec_hash,
        manifest_hash=manifest_hash,
        runtime_source=run.runtime_source,
        entrypoint=run.entrypoint,
        run_source=run.run_source,
        status=run.status,
        model=run.model,
        tools=tools,
        input_preview=run.input_preview,
        input_text=run.input_text,
        output_preview=run.output_preview,
        output_text=run.output_text,
        error=run.error,
        duration_ms=run.duration_ms,
        first_token_ms=run.first_token_ms,
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        total_tokens=run.total_tokens,
        llm_calls=run.llm_calls,
        events=read_run_events(session, run),
        subagents=subagents,
        runtime_manifest=runtime_manifest,
        knowledge_count=run.knowledge_count,
        started_at=run.started_at,
        ended_at=run.ended_at,
    )
