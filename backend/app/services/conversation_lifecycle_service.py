from dataclasses import dataclass

from sqlalchemy import delete
from sqlmodel import Session, select

from app.core.models import (
    AgentRun,
    AgentTestCase,
    AgentTestRun,
    Conversation,
    KnowledgeRetrievalAudit,
    LLMInvocationLog,
    Message,
    RunEvent,
    ToolInvocationAudit,
)
from app.services.upload_resource_service import list_conversation_uploads, safe_unlink_upload


@dataclass(frozen=True)
class ConversationDeleteResult:
    deleted_messages: int = 0
    deleted_uploads: int = 0
    deleted_runs: int = 0
    deleted_llm_logs: int = 0
    deleted_tool_audits: int = 0
    deleted_knowledge_audits: int = 0
    deleted_run_events: int = 0
    cleared_rerun_links: int = 0
    cleared_test_run_links: int = 0
    cleared_test_case_links: int = 0
    deleted_files: int = 0


def delete_conversation_resources(session: Session, conversation: Conversation) -> ConversationDeleteResult:
    org_id = conversation.org_id
    conversation_id = conversation.id
    messages = session.exec(
        select(Message).where(Message.org_id == org_id, Message.conversation_id == conversation_id)
    ).all()
    uploads = list_conversation_uploads(session, org_id, conversation_id)
    runs = session.exec(
        select(AgentRun).where(AgentRun.org_id == org_id, AgentRun.conversation_id == conversation_id)
    ).all()
    run_ids = [run.id for run in runs]

    deleted_files = 0
    for upload in uploads:
        deleted_files += safe_unlink_upload(upload.file_path)

    deleted_llm_logs = _delete_runtime_logs(session, LLMInvocationLog, org_id, conversation_id, run_ids)
    deleted_tool_audits = _delete_tool_audits(session, org_id, conversation_id, run_ids)
    deleted_knowledge_audits = _delete_runtime_logs(
        session,
        KnowledgeRetrievalAudit,
        org_id,
        conversation_id,
        run_ids,
    )
    deleted_run_events = _delete_run_events(session, org_id, run_ids)
    cleared_rerun_links = _clear_rerun_links(session, org_id, run_ids)
    cleared_test_run_links = _clear_test_run_links(session, org_id, run_ids)
    cleared_test_case_links = _clear_test_case_links(session, org_id, run_ids)

    for row in [*messages, *uploads, *runs]:
        session.delete(row)
    session.delete(conversation)
    session.commit()

    return ConversationDeleteResult(
        deleted_messages=len(messages),
        deleted_uploads=len(uploads),
        deleted_runs=len(runs),
        deleted_llm_logs=deleted_llm_logs,
        deleted_tool_audits=deleted_tool_audits,
        deleted_knowledge_audits=deleted_knowledge_audits,
        deleted_run_events=deleted_run_events,
        cleared_rerun_links=cleared_rerun_links,
        cleared_test_run_links=cleared_test_run_links,
        cleared_test_case_links=cleared_test_case_links,
        deleted_files=deleted_files,
    )


def _delete_runtime_logs(session: Session, model, org_id: str, conversation_id: str, run_ids: list[str]) -> int:
    rows = session.exec(
        select(model.id).where(model.org_id == org_id, model.conversation_id == conversation_id)
    ).all()
    log_ids = set(rows)
    if run_ids:
        log_ids.update(
            session.exec(select(model.id).where(model.org_id == org_id, model.run_id.in_(run_ids))).all()
        )
    if not log_ids:
        return 0
    session.exec(delete(model).where(model.org_id == org_id, model.id.in_(list(log_ids))))
    return len(log_ids)


def _delete_tool_audits(session: Session, org_id: str, conversation_id: str, run_ids: list[str]) -> int:
    rows = session.exec(
        select(ToolInvocationAudit.id).where(
            ToolInvocationAudit.org_id == org_id,
            ToolInvocationAudit.conversation_id == conversation_id,
        )
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
    if not audit_ids:
        return 0
    session.exec(
        delete(ToolInvocationAudit).where(
            ToolInvocationAudit.org_id == org_id,
            ToolInvocationAudit.id.in_(list(audit_ids)),
        )
    )
    return len(audit_ids)


def _delete_run_events(session: Session, org_id: str, run_ids: list[str]) -> int:
    if not run_ids:
        return 0
    event_ids = set(
        session.exec(
            select(RunEvent.id).where(
                RunEvent.org_id == org_id,
                RunEvent.run_id.in_(run_ids),
            )
        ).all()
    )
    if not event_ids:
        return 0
    session.exec(delete(RunEvent).where(RunEvent.org_id == org_id, RunEvent.id.in_(list(event_ids))))
    return len(event_ids)


def _clear_rerun_links(session: Session, org_id: str, run_ids: list[str]) -> int:
    if not run_ids:
        return 0
    run_id_set = set(run_ids)
    rows = session.exec(
        select(AgentRun).where(
            AgentRun.org_id == org_id,
            AgentRun.rerun_of_run_id.in_(run_ids),
        )
    ).all()
    cleared = 0
    for row in rows:
        if row.id in run_id_set:
            continue
        row.rerun_of_run_id = None
        session.add(row)
        cleared += 1
    return cleared


def _clear_test_run_links(session: Session, org_id: str, run_ids: list[str]) -> int:
    if not run_ids:
        return 0
    rows = session.exec(
        select(AgentTestRun).where(
            AgentTestRun.org_id == org_id,
            AgentTestRun.agent_run_id.in_(run_ids),
        )
    ).all()
    for row in rows:
        row.agent_run_id = None
        session.add(row)
    return len(rows)


def _clear_test_case_links(session: Session, org_id: str, run_ids: list[str]) -> int:
    if not run_ids:
        return 0
    rows = session.exec(
        select(AgentTestCase).where(
            AgentTestCase.org_id == org_id,
            AgentTestCase.last_run_id.in_(run_ids),
        )
    ).all()
    for row in rows:
        row.last_run_id = None
        row.last_runtime_plan_hash = ""
        session.add(row)
    return len(rows)
