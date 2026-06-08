from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import delete
from sqlmodel import Session, select

from app.core.models import (
    Agent,
    AgentReleaseSnapshot,
    AgentRun,
    AgentTestCase,
    AgentTestRun,
    AgentTestSuiteRun,
    Conversation,
    KnowledgeDocument,
    KnowledgeRetrievalAudit,
    LLMInvocationLog,
    Message,
    RunEvent,
    ToolInvocationAudit,
    Upload,
    now_iso,
)
from app.services.knowledge_chunk_service import delete_agent_chunks
from app.services.runtime_snapshot_service import create_release_snapshot, latest_release_snapshot
from app.services.upload_resource_service import safe_unlink_upload


class AgentLifecycleError(ValueError):
    pass


class AgentPublishPreflight(Protocol):
    can_publish: bool
    runtime_plan_hash: str
    manifest_hash: str


@dataclass(frozen=True)
class AgentDeleteResult:
    deleted_conversations: int = 0
    deleted_messages: int = 0
    deleted_uploads: int = 0
    deleted_runs: int = 0
    deleted_llm_logs: int = 0
    deleted_tool_audits: int = 0
    deleted_knowledge_audits: int = 0
    deleted_run_events: int = 0
    deleted_releases: int = 0
    deleted_knowledge_documents: int = 0
    deleted_test_cases: int = 0
    deleted_test_runs: int = 0
    deleted_test_suite_runs: int = 0
    deleted_files: int = 0


def publish_agent_release(session: Session, agent: Agent, preflight: AgentPublishPreflight) -> Agent:
    if not preflight.can_publish:
        raise AgentLifecycleError("上线检查未通过")

    published_at = now_iso()
    next_version = _next_release_version(session, agent)
    try:
        create_release_snapshot(agent, session, next_version, published_at)
    except ValueError as exc:
        raise AgentLifecycleError(str(exc)) from exc

    agent.status = "published"
    agent.version = next_version
    agent.published_at = published_at
    agent.updated_at = published_at
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


def enable_agent_release(session: Session, agent: Agent, preflight: AgentPublishPreflight) -> Agent:
    if agent.status != "inactive":
        raise AgentLifecycleError("只有停用状态的服务可以重新启用上线版本")
    latest_release = latest_release_snapshot(session, agent.id, agent.org_id)
    if not latest_release:
        raise AgentLifecycleError("没有可启用的上线版本")
    if not preflight.can_publish:
        raise AgentLifecycleError("上线检查未通过")
    release_manifest_hash = getattr(latest_release, "manifest_hash", "") or ""
    if release_manifest_hash and preflight.manifest_hash and release_manifest_hash != preflight.manifest_hash:
        raise AgentLifecycleError("当前运行清单与最近上线版本不一致，请生成新的上线版本")
    if not release_manifest_hash and latest_release.spec_hash != preflight.runtime_plan_hash:
        raise AgentLifecycleError("当前配置与最近上线版本不一致，请生成新的上线版本")

    enabled_at = now_iso()
    agent.status = "published"
    agent.version = latest_release.version
    agent.published_at = latest_release.created_at or enabled_at
    agent.updated_at = enabled_at
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


def deactivate_agent(session: Session, agent: Agent) -> Agent:
    if agent.status == "unpublished":
        raise AgentLifecycleError("未上线服务没有可停用的上线版本")
    if agent.status != "inactive":
        agent.status = "inactive"
    agent.updated_at = now_iso()
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


def _next_release_version(session: Session, agent: Agent) -> int:
    latest = session.exec(
        select(AgentReleaseSnapshot)
        .where(AgentReleaseSnapshot.agent_id == agent.id, AgentReleaseSnapshot.org_id == agent.org_id)
        .order_by(AgentReleaseSnapshot.version.desc())
        .limit(1)
    ).first()
    if latest:
        return latest.version + 1
    return max(agent.version or 1, 1)


def delete_agent_resources(session: Session, agent: Agent) -> AgentDeleteResult:
    org_id = agent.org_id
    agent_id = agent.id
    conversations = session.exec(
        select(Conversation).where(Conversation.org_id == org_id, Conversation.agent_id == agent_id)
    ).all()
    conversation_ids = [conversation.id for conversation in conversations]
    messages = []
    uploads = []
    if conversation_ids:
        messages = session.exec(
            select(Message).where(Message.org_id == org_id, Message.conversation_id.in_(conversation_ids))
        ).all()
        uploads = session.exec(
            select(Upload).where(Upload.org_id == org_id, Upload.conversation_id.in_(conversation_ids))
        ).all()

    runs = session.exec(select(AgentRun).where(AgentRun.org_id == org_id, AgentRun.agent_id == agent_id)).all()
    run_ids = [run.id for run in runs]
    releases = session.exec(
        select(AgentReleaseSnapshot).where(AgentReleaseSnapshot.org_id == org_id, AgentReleaseSnapshot.agent_id == agent_id)
    ).all()
    documents = session.exec(
        select(KnowledgeDocument).where(KnowledgeDocument.org_id == org_id, KnowledgeDocument.agent_id == agent_id)
    ).all()
    test_cases = session.exec(
        select(AgentTestCase).where(AgentTestCase.org_id == org_id, AgentTestCase.agent_id == agent_id)
    ).all()
    test_runs = session.exec(
        select(AgentTestRun).where(AgentTestRun.org_id == org_id, AgentTestRun.agent_id == agent_id)
    ).all()
    test_suite_runs = session.exec(
        select(AgentTestSuiteRun).where(AgentTestSuiteRun.org_id == org_id, AgentTestSuiteRun.agent_id == agent_id)
    ).all()

    deleted_files = 0
    for upload in uploads:
        deleted_files += safe_unlink_upload(upload.file_path)
    for document in documents:
        deleted_files += safe_unlink_upload(document.file_path)

    deleted_llm_logs = _delete_runtime_logs(session, LLMInvocationLog, org_id, agent_id, run_ids, conversation_ids)
    deleted_tool_audits = _delete_tool_audits(session, org_id, agent_id, run_ids, conversation_ids)
    deleted_knowledge_audits = _delete_runtime_logs(
        session,
        KnowledgeRetrievalAudit,
        org_id,
        agent_id,
        run_ids,
        conversation_ids,
    )
    deleted_run_events = _delete_run_events(session, org_id, agent_id, run_ids)
    delete_agent_chunks(session, org_id, agent_id)

    for row in [
        *messages,
        *uploads,
        *conversations,
        *runs,
        *releases,
        *documents,
        *test_runs,
        *test_suite_runs,
        *test_cases,
    ]:
        session.delete(row)
    session.delete(agent)
    session.commit()

    return AgentDeleteResult(
        deleted_conversations=len(conversations),
        deleted_messages=len(messages),
        deleted_uploads=len(uploads),
        deleted_runs=len(runs),
        deleted_llm_logs=deleted_llm_logs,
        deleted_tool_audits=deleted_tool_audits,
        deleted_knowledge_audits=deleted_knowledge_audits,
        deleted_run_events=deleted_run_events,
        deleted_releases=len(releases),
        deleted_knowledge_documents=len(documents),
        deleted_test_cases=len(test_cases),
        deleted_test_runs=len(test_runs),
        deleted_test_suite_runs=len(test_suite_runs),
        deleted_files=deleted_files,
    )


def _delete_runtime_logs(
    session: Session,
    model,
    org_id: str,
    agent_id: str,
    run_ids: list[str],
    conversation_ids: list[str],
) -> int:
    rows = session.exec(select(model.id).where(model.org_id == org_id, model.agent_id == agent_id)).all()
    log_ids = set(rows)
    if run_ids:
        log_ids.update(
            session.exec(select(model.id).where(model.org_id == org_id, model.run_id.in_(run_ids))).all()
        )
    if conversation_ids:
        log_ids.update(
            session.exec(select(model.id).where(model.org_id == org_id, model.conversation_id.in_(conversation_ids))).all()
        )
    if not log_ids:
        return 0
    session.exec(delete(model).where(model.org_id == org_id, model.id.in_(list(log_ids))))
    return len(log_ids)


def _delete_tool_audits(
    session: Session,
    org_id: str,
    agent_id: str,
    run_ids: list[str],
    conversation_ids: list[str],
) -> int:
    rows = session.exec(
        select(ToolInvocationAudit.id).where(ToolInvocationAudit.org_id == org_id, ToolInvocationAudit.agent_id == agent_id)
    ).all()
    audit_ids = set(rows)
    if run_ids:
        audit_ids.update(
            session.exec(
                select(ToolInvocationAudit.id).where(
                    ToolInvocationAudit.org_id == org_id,
                    ToolInvocationAudit.run_id.in_(run_ids),
                )
            ).all()
        )
    if conversation_ids:
        audit_ids.update(
            session.exec(
                select(ToolInvocationAudit.id).where(
                    ToolInvocationAudit.org_id == org_id,
                    ToolInvocationAudit.conversation_id.in_(conversation_ids),
                )
            ).all()
        )
    if not audit_ids:
        return 0
    session.exec(
        delete(ToolInvocationAudit).where(
            ToolInvocationAudit.org_id == org_id,
            ToolInvocationAudit.id.in_(list(audit_ids)),
        )
    )
    return len(audit_ids)


def _delete_run_events(session: Session, org_id: str, agent_id: str, run_ids: list[str]) -> int:
    rows = session.exec(select(RunEvent.id).where(RunEvent.org_id == org_id, RunEvent.agent_id == agent_id)).all()
    event_ids = set(rows)
    if run_ids:
        event_ids.update(
            session.exec(select(RunEvent.id).where(RunEvent.org_id == org_id, RunEvent.run_id.in_(run_ids))).all()
        )
    if not event_ids:
        return 0
    session.exec(delete(RunEvent).where(RunEvent.org_id == org_id, RunEvent.id.in_(list(event_ids))))
    return len(event_ids)
