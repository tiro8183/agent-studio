from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import aliased
from sqlmodel import Session, select

from app.api.deps import AuthContext, get_current_context, require_role
from app.config import settings
from app.core.models import ApiToken, Organization, OrganizationMember, User, new_id, now_iso
from app.core.schemas import (
    ApiTokenCreate,
    ApiTokenCreatedRead,
    ApiTokenRead,
    ApiTokenUserRead,
    AuthLoginRequest,
    AuthSessionRead,
    CurrentUserRead,
    OrganizationMemberCreate,
    OrganizationMemberPasswordReset,
    OrganizationMemberRead,
    OrganizationMemberUpdate,
    OrganizationMemberUserRead,
    OrganizationRead,
    UserRead,
)
from app.db.session import get_session
from app.services.audit_service import record_audit
from app.services.security import expires_after_hours, generate_token, hash_password, hash_token, is_expired, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

ROLE_LABELS = {
    "owner": "所有者",
    "admin": "管理员",
    "editor": "编辑者",
    "viewer": "观察者",
}


def user_to_read(row: User) -> UserRead:
    return UserRead(
        id=row.id,
        email=row.email,
        display_name=row.display_name,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
        last_login_at=row.last_login_at,
    )


def org_to_read(row: Organization) -> OrganizationRead:
    return OrganizationRead(
        id=row.id,
        name=row.name,
        slug=row.slug,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def member_to_read(row: OrganizationMember) -> OrganizationMemberRead:
    return OrganizationMemberRead(
        id=row.id,
        org_id=row.org_id,
        user_id=row.user_id,
        role=row.role,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def member_user_to_read(member: OrganizationMember, user: User) -> OrganizationMemberUserRead:
    return OrganizationMemberUserRead(
        **member_to_read(member).model_dump(),
        user_email=user.email,
        user_display_name=user.display_name,
        user_status=user.status,
        user_last_login_at=user.last_login_at,
    )


def token_to_read(row: ApiToken) -> ApiTokenRead:
    return ApiTokenRead(
        id=row.id,
        name=row.name,
        token_type=row.token_type,
        status=token_status(row),
        expires_at=row.expires_at,
        last_used_at=row.last_used_at,
        revoked_at=row.revoked_at,
        revoked_by=row.revoked_by,
        created_at=row.created_at,
    )


def token_user_to_read(
    row: ApiToken,
    user: User,
    member: OrganizationMember | None,
    revoked_by_user: User | None = None,
) -> ApiTokenUserRead:
    return ApiTokenUserRead(
        id=row.id,
        name=row.name,
        token_type=row.token_type,
        status=token_status(row),
        expires_at=row.expires_at,
        last_used_at=row.last_used_at,
        revoked_at=row.revoked_at,
        revoked_by=row.revoked_by,
        created_at=row.created_at,
        user_id=user.id,
        user_email=user.email,
        user_display_name=user.display_name,
        user_role=member.role if member else None,
        user_status=user.status,
        revoked_by_email=revoked_by_user.email if revoked_by_user else "",
        revoked_by_display_name=revoked_by_user.display_name if revoked_by_user else "",
    )


def token_status(row: ApiToken) -> str:
    if row.status == "active" and is_expired(row.expires_at):
        return "expired"
    return row.status


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else ""


def _normalized_email(email: str) -> str:
    return email.strip().lower()


def _parse_iso_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="过期时间格式不正确") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _personal_token_expiry(payload: ApiTokenCreate) -> str:
    now = datetime.now(timezone.utc)
    max_days = settings.personal_api_token_max_ttl_days
    default_days = min(settings.personal_api_token_default_ttl_days, max_days)
    max_expires_at = now + timedelta(days=max_days)
    if payload.expires_at:
        requested = _parse_iso_datetime(payload.expires_at)
        if requested <= now:
            raise HTTPException(status_code=422, detail="过期时间必须晚于当前时间")
        if requested > max_expires_at:
            raise HTTPException(status_code=422, detail=f"个人 API Token 有效期不能超过 {max_days} 天")
        return requested.isoformat()
    return (now + timedelta(days=default_days)).isoformat()


def _mark_token_revoked(row: ApiToken, actor_user_id: str) -> None:
    row.status = "revoked"
    row.revoked_at = now_iso()
    row.revoked_by = actor_user_id


def _ensure_owner_role_grant_allowed(context: AuthContext, role: str) -> None:
    if role == "owner" and context.membership.role != "owner":
        raise HTTPException(status_code=403, detail="只有所有者可以授予所有者角色")


def _ensure_target_member_manageable(context: AuthContext, target: OrganizationMember) -> None:
    if target.org_id != context.organization.id:
        raise HTTPException(status_code=404, detail="成员不存在")
    if target.role == "owner" and context.membership.role != "owner":
        raise HTTPException(status_code=403, detail="只有所有者可以调整所有者成员")


def _active_owner_count(session: Session, org_id: str) -> int:
    return len(
        session.exec(
            select(OrganizationMember).where(
                OrganizationMember.org_id == org_id,
                OrganizationMember.role == "owner",
                OrganizationMember.status == "active",
            )
        ).all()
    )


def _would_remove_active_owner(member: OrganizationMember, payload: OrganizationMemberUpdate) -> bool:
    if member.role != "owner" or member.status != "active":
        return False
    role_removes_owner = payload.role is not None and payload.role != "owner"
    status_disables_owner = payload.status is not None and payload.status != "active"
    return role_removes_owner or status_disables_owner


def _ensure_member_update_allowed(
    *,
    session: Session,
    context: AuthContext,
    target: OrganizationMember,
    payload: OrganizationMemberUpdate,
) -> None:
    if payload.role is None and payload.status is None:
        raise HTTPException(status_code=400, detail="至少需要提供 role 或 status")
    _ensure_target_member_manageable(context, target)
    if payload.role is not None:
        _ensure_owner_role_grant_allowed(context, payload.role)
    if target.user_id == context.user.id and payload.role is not None and payload.role != target.role:
        raise HTTPException(status_code=409, detail="不能调整自己的当前角色")
    if target.user_id == context.user.id and payload.status == "disabled":
        raise HTTPException(status_code=409, detail="不能停用自己的当前成员身份")
    if _would_remove_active_owner(target, payload) and _active_owner_count(session, target.org_id) <= 1:
        raise HTTPException(status_code=409, detail="组织必须至少保留一个启用的所有者")


def _revoke_member_tokens(session: Session, member: OrganizationMember, actor_user_id: str) -> None:
    tokens = session.exec(
        select(ApiToken).where(
            ApiToken.org_id == member.org_id,
            ApiToken.user_id == member.user_id,
            ApiToken.status == "active",
        )
    ).all()
    for token in tokens:
        _mark_token_revoked(token, actor_user_id)
        session.add(token)


@router.post("/login", response_model=AuthSessionRead)
def login(payload: AuthLoginRequest, request: Request, session: Session = Depends(get_session)) -> AuthSessionRead:
    email = payload.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if not user or user.status != "active" or not verify_password(payload.password, user.password_hash):
        record_audit(
            session,
            action="auth.login",
            status="failed",
            resource_type="user",
            resource_id=email,
            ip=_client_ip(request),
            user_agent=request.headers.get("user-agent", ""),
            metadata={"reason": "invalid_credentials"},
        )
        raise HTTPException(status_code=401, detail="邮箱或密码错误")

    membership = session.exec(
        select(OrganizationMember)
        .where(OrganizationMember.user_id == user.id, OrganizationMember.status == "active")
        .order_by(OrganizationMember.created_at.asc())
    ).first()
    org = session.get(Organization, membership.org_id) if membership else None
    if not membership or not org or org.status != "active":
        raise HTTPException(status_code=403, detail="账号未加入可用组织")

    raw_token = generate_token()
    expires_at = expires_after_hours(settings.access_token_ttl_hours)
    token = ApiToken(
        id=new_id("token"),
        token_hash=hash_token(raw_token),
        user_id=user.id,
        org_id=org.id,
        token_type="web_session",
        name="Web Session",
        expires_at=expires_at,
    )
    user.last_login_at = now_iso()
    user.updated_at = user.last_login_at
    session.add(user)
    session.add(token)
    session.commit()
    session.refresh(token)
    record_audit(
        session,
        action="auth.login",
        status="success",
        org_id=org.id,
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    return AuthSessionRead(
        access_token=raw_token,
        expires_at=expires_at,
        user=user_to_read(user),
        organization=org_to_read(org),
        membership=member_to_read(membership),
    )


@router.get("/me", response_model=CurrentUserRead)
def me(context: AuthContext = Depends(get_current_context)) -> CurrentUserRead:
    return CurrentUserRead(
        user=user_to_read(context.user),
        organization=org_to_read(context.organization),
        membership=member_to_read(context.membership),
    )


@router.get("/members", response_model=list[OrganizationMemberUserRead])
def list_members(
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> list[OrganizationMemberUserRead]:
    rows = session.exec(
        select(OrganizationMember, User)
        .join(User, OrganizationMember.user_id == User.id)
        .where(OrganizationMember.org_id == context.organization.id)
        .order_by(OrganizationMember.created_at.asc())
    ).all()
    return [member_user_to_read(member, user) for member, user in rows]


@router.post("/members", response_model=OrganizationMemberUserRead)
def create_member(
    payload: OrganizationMemberCreate,
    request: Request,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> OrganizationMemberUserRead:
    _ensure_owner_role_grant_allowed(context, payload.role)
    email = _normalized_email(payload.email)
    if "@" not in email:
        raise HTTPException(status_code=422, detail="邮箱格式不正确")
    existing_user = session.exec(select(User).where(User.email == email)).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="邮箱已存在")
    timestamp = now_iso()
    user = User(
        id=new_id("user"),
        email=email,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        created_at=timestamp,
        updated_at=timestamp,
    )
    member = OrganizationMember(
        id=new_id("member"),
        org_id=context.organization.id,
        user_id=user.id,
        role=payload.role,
        status="active",
        created_at=timestamp,
        updated_at=timestamp,
    )
    session.add(user)
    session.add(member)
    session.commit()
    session.refresh(user)
    session.refresh(member)
    record_audit(
        session,
        action="auth.member.create",
        status="success",
        org_id=context.organization.id,
        user_id=context.user.id,
        resource_type="organization_member",
        resource_id=member.id,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        metadata={
            "target_user_id": user.id,
            "target_user_email": user.email,
            "target_role": member.role,
            "target_role_label": ROLE_LABELS.get(member.role, member.role),
        },
    )
    return member_user_to_read(member, user)


@router.post("/members/{member_id}/password", response_model=OrganizationMemberUserRead)
def reset_member_password(
    member_id: str,
    payload: OrganizationMemberPasswordReset,
    request: Request,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> OrganizationMemberUserRead:
    member = session.get(OrganizationMember, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="成员不存在")
    _ensure_target_member_manageable(context, member)
    if member.user_id == context.user.id:
        raise HTTPException(status_code=409, detail="不能重置自己的当前密码")
    user = session.get(User, member.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="成员用户不存在")
    timestamp = now_iso()
    user.password_hash = hash_password(payload.password)
    user.updated_at = timestamp
    member.updated_at = timestamp
    _revoke_member_tokens(session, member, context.user.id)
    session.add(user)
    session.add(member)
    session.commit()
    session.refresh(user)
    session.refresh(member)
    record_audit(
        session,
        action="auth.member.password_reset",
        status="success",
        org_id=context.organization.id,
        user_id=context.user.id,
        resource_type="organization_member",
        resource_id=member.id,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        metadata={
            "target_user_id": user.id,
            "target_user_email": user.email,
            "revoked_tokens": True,
        },
    )
    return member_user_to_read(member, user)


@router.patch("/members/{member_id}", response_model=OrganizationMemberUserRead)
def update_member(
    member_id: str,
    payload: OrganizationMemberUpdate,
    request: Request,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> OrganizationMemberUserRead:
    member = session.get(OrganizationMember, member_id)
    if not member or member.org_id != context.organization.id:
        raise HTTPException(status_code=404, detail="成员不存在")
    _ensure_member_update_allowed(session=session, context=context, target=member, payload=payload)
    before = {"role": member.role, "status": member.status}
    if payload.role is not None:
        member.role = payload.role
    if payload.status is not None:
        member.status = payload.status
        if payload.status == "disabled":
            _revoke_member_tokens(session, member, context.user.id)
    member.updated_at = now_iso()
    session.add(member)
    session.commit()
    session.refresh(member)
    user = session.get(User, member.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="成员用户不存在")
    record_audit(
        session,
        action="auth.member.update",
        status="success",
        org_id=context.organization.id,
        user_id=context.user.id,
        resource_type="organization_member",
        resource_id=member.id,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        metadata={
            "before": before,
            "after": {"role": member.role, "status": member.status},
            "target_user_id": member.user_id,
            "target_user_email": user.email,
            "target_role_label": ROLE_LABELS.get(member.role, member.role),
        },
    )
    return member_user_to_read(member, user)


@router.get("/tokens", response_model=list[ApiTokenRead])
def list_tokens(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> list[ApiTokenRead]:
    rows = session.exec(
        select(ApiToken)
        .where(
            ApiToken.user_id == context.user.id,
            ApiToken.org_id == context.organization.id,
            ApiToken.token_type == "personal_api_token",
        )
        .order_by(ApiToken.created_at.desc())
    ).all()
    return [token_to_read(row) for row in rows]


@router.get("/org-tokens", response_model=list[ApiTokenUserRead])
def list_organization_tokens(
    request: Request,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> list[ApiTokenUserRead]:
    token_owner = aliased(User)
    token_revoker = aliased(User)
    rows = session.exec(
        select(ApiToken, token_owner, OrganizationMember, token_revoker)
        .join(token_owner, ApiToken.user_id == token_owner.id)
        .join(
            OrganizationMember,
            (OrganizationMember.org_id == ApiToken.org_id) & (OrganizationMember.user_id == ApiToken.user_id),
            isouter=True,
        )
        .join(token_revoker, ApiToken.revoked_by == token_revoker.id, isouter=True)
        .where(ApiToken.org_id == context.organization.id, ApiToken.token_type == "personal_api_token")
        .order_by(ApiToken.created_at.desc())
    ).all()
    record_audit(
        session,
        action="auth.token.org_list",
        status="success",
        org_id=context.organization.id,
        user_id=context.user.id,
        resource_type="api_token",
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        metadata={"count": len(rows)},
    )
    return [token_user_to_read(token, user, member, revoked_by_user) for token, user, member, revoked_by_user in rows]


@router.post("/tokens", response_model=ApiTokenCreatedRead)
def create_token(
    payload: ApiTokenCreate,
    request: Request,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> ApiTokenCreatedRead:
    raw_token = generate_token()
    expires_at = _personal_token_expiry(payload)
    row = ApiToken(
        id=new_id("token"),
        token_hash=hash_token(raw_token),
        user_id=context.user.id,
        org_id=context.organization.id,
        token_type="personal_api_token",
        name=payload.name,
        expires_at=expires_at,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    record_audit(
        session,
        action="auth.token.create",
        status="success",
        org_id=context.organization.id,
        user_id=context.user.id,
        resource_type="api_token",
        resource_id=row.id,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        metadata={"name": row.name, "expires_at": row.expires_at},
    )
    return ApiTokenCreatedRead(**token_to_read(row).model_dump(), token=raw_token)


@router.delete("/tokens/{token_id}")
def revoke_token(
    token_id: str,
    request: Request,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    row = session.get(ApiToken, token_id)
    if (
        not row
        or row.user_id != context.user.id
        or row.org_id != context.organization.id
        or row.token_type != "personal_api_token"
    ):
        raise HTTPException(status_code=404, detail="Token 不存在")
    _mark_token_revoked(row, context.user.id)
    session.add(row)
    session.commit()
    record_audit(
        session,
        action="auth.token.revoke",
        status="success",
        org_id=context.organization.id,
        user_id=context.user.id,
        resource_type="api_token",
        resource_id=row.id,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        metadata={"name": row.name, "revoked_at": row.revoked_at},
    )
    return {"status": "revoked"}


@router.delete("/org-tokens/{token_id}")
def revoke_organization_token(
    token_id: str,
    request: Request,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    row = session.get(ApiToken, token_id)
    if not row or row.org_id != context.organization.id or row.token_type != "personal_api_token":
        raise HTTPException(status_code=404, detail="Token 不存在")
    if row.id == context.token.id:
        raise HTTPException(status_code=409, detail="不能通过组织治理撤销当前请求令牌")
    owner_membership = session.exec(
        select(OrganizationMember).where(
            OrganizationMember.org_id == context.organization.id,
            OrganizationMember.user_id == row.user_id,
        )
    ).first()
    if owner_membership and owner_membership.role == "owner" and context.membership.role != "owner":
        raise HTTPException(status_code=403, detail="只有所有者可以撤销所有者的访问令牌")
    owner = session.get(User, row.user_id)
    _mark_token_revoked(row, context.user.id)
    session.add(row)
    session.commit()
    record_audit(
        session,
        action="auth.token.admin_revoke",
        status="success",
        org_id=context.organization.id,
        user_id=context.user.id,
        resource_type="api_token",
        resource_id=row.id,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        metadata={
            "name": row.name,
            "target_user_id": row.user_id,
            "target_user_email": owner.email if owner else "",
            "revoked_at": row.revoked_at,
        },
    )
    return {"status": "revoked"}
