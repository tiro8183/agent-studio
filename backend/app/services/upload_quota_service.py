from dataclasses import dataclass

from fastapi import HTTPException
from sqlmodel import Session, func, select

from app.core.models import KnowledgeDocument, Upload


@dataclass(frozen=True)
class UploadQuotaPolicy:
    max_total_bytes: int


@dataclass(frozen=True)
class UploadQuotaUsage:
    max_total_bytes: int
    used_bytes: int
    remaining_bytes: int
    attachment_bytes: int
    knowledge_bytes: int


def get_upload_quota_usage(session: Session, org_id: str, policy: UploadQuotaPolicy) -> UploadQuotaUsage:
    attachment_bytes = int(
        session.exec(select(func.sum(Upload.size)).where(Upload.org_id == org_id)).one() or 0
    )
    knowledge_bytes = int(
        session.exec(select(func.sum(KnowledgeDocument.size)).where(KnowledgeDocument.org_id == org_id)).one() or 0
    )
    used_bytes = attachment_bytes + knowledge_bytes
    return UploadQuotaUsage(
        max_total_bytes=policy.max_total_bytes,
        used_bytes=used_bytes,
        remaining_bytes=max(policy.max_total_bytes - used_bytes, 0),
        attachment_bytes=attachment_bytes,
        knowledge_bytes=knowledge_bytes,
    )


def ensure_upload_quota(
    session: Session,
    org_id: str,
    policy: UploadQuotaPolicy,
    incoming_bytes: int,
) -> UploadQuotaUsage:
    usage = get_upload_quota_usage(session, org_id, policy)
    if usage.used_bytes + incoming_bytes > policy.max_total_bytes:
        raise HTTPException(status_code=413, detail="组织上传配额不足")
    return usage
