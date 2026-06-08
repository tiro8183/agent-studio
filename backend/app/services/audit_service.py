import json
from typing import Any

from sqlmodel import Session, select

from app.core.models import AuditLog, User


SENSITIVE_KEYS = {"api_key", "password", "token", "value", "secret", "authorization"}


def sanitize_metadata(value: Any, max_text: int = 600) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            if key.lower() in SENSITIVE_KEYS or "secret" in key.lower():
                sanitized[key] = "***"
            else:
                sanitized[key] = sanitize_metadata(item, max_text=max_text)
        return sanitized
    if isinstance(value, list):
        return [sanitize_metadata(item, max_text=max_text) for item in value[:50]]
    if isinstance(value, str) and len(value) > max_text:
        return value[:max_text] + "..."
    return value


def record_audit(
    session: Session,
    *,
    action: str,
    status: str,
    org_id: str | None = None,
    user_id: str | None = None,
    resource_type: str = "",
    resource_id: str = "",
    ip: str = "",
    user_agent: str = "",
    metadata: dict[str, Any] | None = None,
) -> AuditLog:
    row = AuditLog(
        org_id=org_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        status=status,
        ip=ip,
        user_agent=user_agent[:500],
        metadata_json=json.dumps(sanitize_metadata(metadata or {}), ensure_ascii=False),
    )
    session.add(row)
    session.commit()
    return row


def list_audit_logs(
    session: Session,
    *,
    org_id: str,
    limit: int = 100,
    action: str | None = None,
) -> list[tuple[AuditLog, str]]:
    stmt = (
        select(AuditLog)
        .where(AuditLog.org_id == org_id)
        .order_by(AuditLog.created_at.desc())
        .limit(min(max(limit, 1), 500))
    )
    if action:
        stmt = stmt.where(AuditLog.action == action)
    rows = session.exec(stmt).all()
    user_ids = {row.user_id for row in rows if row.user_id}
    users = {}
    if user_ids:
        users = {user.id: user.email for user in session.exec(select(User).where(User.id.in_(user_ids))).all()}
    return [(row, users.get(row.user_id or "", "")) for row in rows]
