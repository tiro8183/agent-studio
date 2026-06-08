import json

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.deps import AuthContext, require_role
from app.core.schemas import AuditLogRead
from app.db.session import get_session
from app.services.audit_service import list_audit_logs

router = APIRouter(prefix="/audits", tags=["audits"])


@router.get("", response_model=list[AuditLogRead])
def audits(
    limit: int = 100,
    action: str | None = None,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> list[AuditLogRead]:
    rows = list_audit_logs(session, org_id=context.organization.id, limit=limit, action=action)
    result: list[AuditLogRead] = []
    for row, email in rows:
        try:
            metadata = json.loads(row.metadata_json or "{}")
        except json.JSONDecodeError:
            metadata = {}
        result.append(
            AuditLogRead(
                id=row.id,
                org_id=row.org_id,
                user_id=row.user_id,
                user_email=email,
                action=row.action,
                resource_type=row.resource_type,
                resource_id=row.resource_id,
                status=row.status,
                ip=row.ip,
                user_agent=row.user_agent,
                metadata=metadata,
                created_at=row.created_at,
            )
        )
    return result
