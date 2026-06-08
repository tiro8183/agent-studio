import hashlib
from typing import Iterable

from sqlalchemy import delete, func
from sqlmodel import Session, select

from app.core.models import KnowledgeChunkRecord, KnowledgeDocument
from app.services.knowledge_retrieval_service import KnowledgeChunk, chunk_text, content_hash


def persist_document_chunks(session: Session, document: KnowledgeDocument, content_text: str) -> list[KnowledgeChunkRecord]:
    delete_document_chunks(session, document.org_id, document.id)
    hash_value = content_hash(content_text)
    chunks = chunk_text(
        content_text,
        document_id=document.id,
        file_name=document.file_name,
        content_hash=hash_value,
    )
    records = [
        KnowledgeChunkRecord(
            id=chunk.chunk_id,
            org_id=document.org_id,
            agent_id=document.agent_id,
            document_id=document.id,
            file_name=document.file_name,
            ordinal=chunk.ordinal,
            text=chunk.text,
            char_count=len(chunk.text),
            content_hash=hash_value,
            chunk_hash=_chunk_hash(chunk.text),
        )
        for chunk in chunks
    ]
    for record in records:
        session.add(record)
    return records


def delete_document_chunks(session: Session, org_id: str, document_id: str) -> None:
    session.exec(
        delete(KnowledgeChunkRecord).where(
            KnowledgeChunkRecord.org_id == org_id,
            KnowledgeChunkRecord.document_id == document_id,
        )
    )


def delete_agent_chunks(session: Session, org_id: str, agent_id: str) -> None:
    session.exec(
        delete(KnowledgeChunkRecord).where(
            KnowledgeChunkRecord.org_id == org_id,
            KnowledgeChunkRecord.agent_id == agent_id,
        )
    )


def list_document_chunks(session: Session, org_id: str, document_id: str) -> list[KnowledgeChunkRecord]:
    return list(
        session.exec(
            select(KnowledgeChunkRecord)
            .where(KnowledgeChunkRecord.org_id == org_id, KnowledgeChunkRecord.document_id == document_id)
            .order_by(KnowledgeChunkRecord.ordinal)
        ).all()
    )


def list_agent_chunks(session: Session, org_id: str, agent_id: str) -> list[KnowledgeChunkRecord]:
    return list(
        session.exec(
            select(KnowledgeChunkRecord)
            .where(KnowledgeChunkRecord.org_id == org_id, KnowledgeChunkRecord.agent_id == agent_id)
            .order_by(KnowledgeChunkRecord.document_id, KnowledgeChunkRecord.ordinal)
        ).all()
    )


def count_chunks_by_document(session: Session, org_id: str, document_ids: Iterable[str]) -> dict[str, int]:
    ids = [document_id for document_id in document_ids if document_id]
    if not ids:
        return {}
    rows = session.exec(
        select(KnowledgeChunkRecord.document_id, func.count(KnowledgeChunkRecord.id))
        .where(
            KnowledgeChunkRecord.org_id == org_id,
            KnowledgeChunkRecord.document_id.in_(ids),
        )
        .group_by(KnowledgeChunkRecord.document_id)
    ).all()
    return {str(document_id): int(count) for document_id, count in rows}


def record_to_chunk(record: KnowledgeChunkRecord) -> KnowledgeChunk:
    return KnowledgeChunk(
        document_id=record.document_id,
        file_name=record.file_name,
        chunk_id=record.id,
        ordinal=record.ordinal,
        text=record.text,
        content_hash=record.content_hash,
    )


def records_to_chunks(records: Iterable[KnowledgeChunkRecord]) -> list[KnowledgeChunk]:
    return [record_to_chunk(record) for record in records]


def _chunk_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text else ""
