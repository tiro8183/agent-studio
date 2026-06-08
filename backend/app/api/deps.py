from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request
from sqlmodel import Session, select

from app.core.models import ApiToken, Organization, OrganizationMember, User, now_iso
from app.db.session import get_session
from app.services.security import hash_token, is_expired


ROLE_RANK = {"viewer": 10, "editor": 20, "admin": 30, "owner": 40}


@dataclass(frozen=True)
class AuthContext:
    user: User
    organization: Organization
    membership: OrganizationMember
    token: ApiToken


def get_current_context(
    request: Request,
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> AuthContext:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="需要登录")
    raw_token = authorization.split(" ", 1)[1].strip()
    if not raw_token:
        raise HTTPException(status_code=401, detail="需要登录")
    token = session.exec(select(ApiToken).where(ApiToken.token_hash == hash_token(raw_token))).first()
    if not token or token.status != "active" or is_expired(token.expires_at):
        raise HTTPException(status_code=401, detail="登录已失效")
    user = session.get(User, token.user_id)
    org = session.get(Organization, token.org_id)
    membership = session.exec(
        select(OrganizationMember).where(
            OrganizationMember.user_id == token.user_id,
            OrganizationMember.org_id == token.org_id,
            OrganizationMember.status == "active",
        )
    ).first()
    if not user or user.status != "active" or not org or org.status != "active" or not membership:
        raise HTTPException(status_code=403, detail="账号或组织已停用")
    context = AuthContext(user=user, organization=org, membership=membership, token=token)
    request.state.audit_context = {
        "user_id": user.id,
        "org_id": org.id,
        "role": membership.role,
    }
    request.state.auth_context = context
    token.last_used_at = now_iso()
    session.add(token)
    session.commit()
    return context


def require_role(min_role: str):
    def dependency(context: AuthContext = Depends(get_current_context)) -> AuthContext:
        current_rank = ROLE_RANK.get(context.membership.role, 0)
        required_rank = ROLE_RANK[min_role]
        if current_rank < required_rank:
            raise HTTPException(status_code=403, detail="权限不足")
        return context

    return dependency


def require_write_access(
    request: Request,
    context: AuthContext = Depends(get_current_context),
) -> AuthContext:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return context
    current_rank = ROLE_RANK.get(context.membership.role, 0)
    if current_rank < ROLE_RANK["editor"]:
        raise HTTPException(status_code=403, detail="需要编辑权限")
    return context
