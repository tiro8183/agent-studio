from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile
from sqlmodel import Session

from app.api.deps import AuthContext, require_role
from app.config import settings
from app.core.models import Upload, new_id
from app.core.schemas import UploadRead
from app.db.session import get_session
from app.services.tenant_scope import get_conversation_or_404
from app.services.upload_quota_service import UploadQuotaPolicy, ensure_upload_quota
from app.services.upload_resource_service import build_upload_target, safe_upload_name
from app.services.upload_security import read_limited_upload

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("", response_model=UploadRead)
async def upload_file(
    file: UploadFile = File(...),
    conversation_id: Optional[str] = None,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> UploadRead:
    org_id = context.organization.id
    if conversation_id:
        get_conversation_or_404(session, conversation_id, org_id)
    upload_id = new_id("file")
    safe_name = safe_upload_name(file.filename, "attachment.txt")
    content = await read_limited_upload(
        file,
        max_bytes=settings.upload_max_bytes,
        allowed_content_types=settings.upload_allowed_content_types,
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
        resource_type="attachments",
        resource_id=conversation_id or "unassigned",
        record_id=upload_id,
        file_name=safe_name,
    )
    target.write_bytes(content)

    row = Upload(
        id=upload_id,
        org_id=org_id,
        conversation_id=conversation_id,
        file_name=safe_name,
        file_path=str(target),
        content_type=file.content_type,
        size=len(content),
    )
    session.add(row)
    session.commit()
    return UploadRead(
        id=row.id,
        org_id=row.org_id,
        file_name=row.file_name,
        content_type=row.content_type,
        size=row.size,
    )
