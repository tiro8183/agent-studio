from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, UploadFile
from sqlmodel import Session, select

from app.api.deps import AuthContext, get_current_context, require_role
from app.config import settings
from app.core.models import KnowledgeChunkRecord, KnowledgeDocument, new_id
from app.core.schemas import KnowledgeChunkRead, KnowledgeDocumentDetail, KnowledgeDocumentRead
from app.db.session import get_session
from app.services.knowledge_chunk_service import (
    count_chunks_by_document,
    delete_document_chunks,
    list_document_chunks,
    persist_document_chunks,
)
from app.services.tenant_scope import get_agent_or_404, get_document_or_404
from app.services.upload_quota_service import UploadQuotaPolicy, ensure_upload_quota
from app.services.upload_resource_service import build_upload_target, safe_unlink_upload, safe_upload_name
from app.services.upload_security import read_limited_upload

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("/{agent_id}", response_model=List[KnowledgeDocumentRead])
def list_documents(
    agent_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[KnowledgeDocumentRead]:
    org_id = context.organization.id
    get_agent_or_404(session, agent_id, org_id)
    stmt = (
        select(KnowledgeDocument)
        .where(KnowledgeDocument.agent_id == agent_id, KnowledgeDocument.org_id == org_id)
        .order_by(KnowledgeDocument.created_at.desc())
    )
    rows = list(session.exec(stmt).all())
    chunk_counts = count_chunks_by_document(session, org_id, [row.id for row in rows])
    return [_document_read(row, chunk_counts.get(row.id, 0)) for row in rows]


@router.get("/documents/{document_id}", response_model=KnowledgeDocumentDetail)
def get_document(
    document_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> KnowledgeDocumentDetail:
    row = get_document_or_404(session, document_id, context.organization.id)
    path = Path(row.file_path)
    content = ""
    if path.exists() and row.size <= 1024 * 1024:
        content = path.read_text(encoding="utf-8", errors="ignore")
    chunks = list_document_chunks(session, context.organization.id, row.id)
    return KnowledgeDocumentDetail(
        **row.model_dump(),
        content=content,
        chunk_count=len(chunks),
        chunks=[_chunk_read(chunk) for chunk in chunks[:20]],
    )


@router.post("/{agent_id}", response_model=KnowledgeDocumentRead)
async def upload_document(
    agent_id: str,
    file: UploadFile = File(...),
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> KnowledgeDocumentRead:
    org_id = context.organization.id
    get_agent_or_404(session, agent_id, org_id)

    document_id = new_id("kb")
    safe_name = safe_upload_name(file.filename, "document.txt")
    content = await read_limited_upload(
        file,
        max_bytes=settings.knowledge_upload_max_bytes,
        allowed_content_types=settings.knowledge_allowed_content_types,
        allowed_extensions=settings.text_upload_extensions,
    )
    ensure_upload_quota(
        session,
        org_id,
        UploadQuotaPolicy(max_total_bytes=settings.upload_quota_total_bytes),
        len(content),
    )
    target = build_upload_target(
        org_id=org_id,
        resource_type="knowledge",
        resource_id=agent_id,
        record_id=document_id,
        file_name=safe_name,
    )
    target.write_bytes(content)
    text_preview = content.decode("utf-8", errors="ignore")

    row = KnowledgeDocument(
        id=document_id,
        org_id=org_id,
        agent_id=agent_id,
        file_name=safe_name,
        file_path=str(target),
        content_type=file.content_type,
        size=len(content),
        char_count=len(text_preview),
        preview=text_preview[:240],
    )
    session.add(row)
    persist_document_chunks(session, row, text_preview)
    session.commit()
    session.refresh(row)
    chunk_count = len(list_document_chunks(session, org_id, row.id))
    return _document_read(row, chunk_count)


@router.delete("/{document_id}")
def delete_document(
    document_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    row = get_document_or_404(session, document_id, context.organization.id)
    safe_unlink_upload(row.file_path)
    delete_document_chunks(session, row.org_id, row.id)
    session.delete(row)
    session.commit()
    return {"status": "deleted"}


def _document_read(row: KnowledgeDocument, chunk_count: int = 0) -> KnowledgeDocumentRead:
    return KnowledgeDocumentRead(**row.model_dump(), chunk_count=chunk_count)


def _chunk_read(chunk: KnowledgeChunkRecord) -> KnowledgeChunkRead:
    return KnowledgeChunkRead(**chunk.model_dump())
