import json
from typing import Any

from sqlmodel import Session, select

from app.core.models import KnowledgeRetrievalAudit
from app.core.schemas import KnowledgeRetrievalAuditRead
from app.services.knowledge_retrieval_service import RetrievalResult


def record_knowledge_retrieval_audit(
    session: Session,
    *,
    org_id: str,
    agent_id: str,
    run_id: str,
    conversation_id: str,
    source: str,
    result: RetrievalResult,
) -> KnowledgeRetrievalAudit | None:
    audit = result.audit or {}
    if not int(audit.get("indexed_chunks") or 0):
        return None
    row = KnowledgeRetrievalAudit(
        org_id=org_id,
        agent_id=agent_id,
        run_id=run_id,
        conversation_id=conversation_id,
        source=source,
        query_preview=str(audit.get("query_preview") or "")[:240],
        index_source=str(audit.get("index_source") or ""),
        indexed_chunks=int(audit.get("indexed_chunks") or 0),
        retrieved_chunks=int(audit.get("retrieved_chunks") or 0),
        terms_json=_dumps_list(audit.get("terms") or []),
        chunk_refs_json=_dumps_list(audit.get("sources") or []),
    )
    session.add(row)
    return row


def list_knowledge_retrieval_audits(
    session: Session,
    *,
    org_id: str,
    run_id: str | None = None,
    agent_id: str | None = None,
    conversation_id: str | None = None,
    limit: int = 50,
) -> list[KnowledgeRetrievalAuditRead]:
    stmt = select(KnowledgeRetrievalAudit).where(KnowledgeRetrievalAudit.org_id == org_id)
    if run_id:
        stmt = stmt.where(KnowledgeRetrievalAudit.run_id == run_id)
    if agent_id:
        stmt = stmt.where(KnowledgeRetrievalAudit.agent_id == agent_id)
    if conversation_id:
        stmt = stmt.where(KnowledgeRetrievalAudit.conversation_id == conversation_id)
    rows = session.exec(stmt.order_by(KnowledgeRetrievalAudit.created_at.desc()).limit(min(limit, 100))).all()
    return [knowledge_retrieval_audit_to_read(row) for row in rows]


def knowledge_retrieval_audit_to_read(row: KnowledgeRetrievalAudit) -> KnowledgeRetrievalAuditRead:
    return KnowledgeRetrievalAuditRead(
        id=row.id,
        org_id=row.org_id,
        agent_id=row.agent_id,
        run_id=row.run_id,
        conversation_id=row.conversation_id,
        source=row.source,
        query_preview=row.query_preview,
        index_source=row.index_source,
        indexed_chunks=row.indexed_chunks,
        retrieved_chunks=row.retrieved_chunks,
        terms=_loads_list(row.terms_json),
        chunk_refs=_loads_list(row.chunk_refs_json),
        created_at=row.created_at,
    )


def _dumps_list(value: Any) -> str:
    items = value if isinstance(value, list) else []
    return json.dumps(items[:50], ensure_ascii=False)


def _loads_list(value: str) -> list[Any]:
    try:
        parsed = json.loads(value or "[]")
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []
