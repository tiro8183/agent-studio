import re
from collections.abc import Iterable

from fastapi import HTTPException
from sqlmodel import Session, select

from app.core.models import Agent

AGENT_SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_SLUG_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def normalize_agent_slug(value: str) -> str:
    tokens = _SLUG_TOKEN_PATTERN.findall(value.strip().lower())
    return "-".join(tokens)


def fallback_agent_slug(agent_id: str) -> str:
    suffix = agent_id.removeprefix("agent_").replace("_", "-")
    normalized = normalize_agent_slug(suffix)
    return f"agent-{normalized[:24]}" if normalized else "agent-service"


def validate_agent_slug(value: str) -> str:
    slug = value.strip().lower()
    if not AGENT_SLUG_PATTERN.fullmatch(slug):
        raise HTTPException(status_code=422, detail="服务标识只能包含小写字母、数字和短横线")
    if len(slug) > 80:
        raise HTTPException(status_code=422, detail="服务标识不能超过 80 个字符")
    return slug


def default_agent_slug(agent_id: str, name: str) -> str:
    return normalize_agent_slug(name)[:80] or fallback_agent_slug(agent_id)


def ensure_unique_agent_slug(
    session: Session,
    org_id: str,
    slug: str,
    *,
    exclude_agent_id: str | None = None,
) -> str:
    candidate = validate_agent_slug(slug)
    existing = session.exec(
        select(Agent).where(Agent.org_id == org_id, Agent.slug == candidate).limit(1)
    ).first()
    if existing and existing.id != exclude_agent_id:
        raise HTTPException(status_code=409, detail="服务标识已被占用")
    return candidate


def unique_slug_for_agent(
    session: Session,
    org_id: str,
    agent_id: str,
    name: str,
    preferred_slug: str | None = None,
) -> str:
    base = validate_agent_slug(preferred_slug) if preferred_slug else default_agent_slug(agent_id, name)
    if not base:
        base = fallback_agent_slug(agent_id)

    existing_slugs = set(
        session.exec(
            select(Agent.slug).where(Agent.org_id == org_id, Agent.slug.startswith(base))
        ).all()
    )
    return _next_available_slug(base, existing_slugs)


def _next_available_slug(base: str, existing_slugs: Iterable[str]) -> str:
    existing = set(existing_slugs)
    if base not in existing:
        return base

    trimmed = base[:72].rstrip("-") or "agent-service"
    counter = 2
    while True:
        candidate = f"{trimmed}-{counter}"
        if candidate not in existing:
            return candidate
        counter += 1
