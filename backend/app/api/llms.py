from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import AuthContext, get_current_context, require_role
from app.core.models import LLMConfig, new_id, now_iso
from app.core.schemas import LLMCheckRead, LLMConfigCreate, LLMConfigRead, LLMConfigUpdate
from app.db.session import get_session
from app.services.mappers import _dumps, _loads, llm_from_create, llm_to_read
from app.services.llm_governance_service import llm_deletion_usage, llm_deletion_usage_detail
from app.services.llm_provider_policy import validate_default_model, validate_llm_provider_contract
from app.services.runtime_adapter.model_init import probe_chat_model
from app.services.secret_codec import encrypt_secret
from app.services.tenant_scope import get_llm_or_404
from app.services.tool_governance import reject_sensitive_headers

router = APIRouter(prefix="/llms", tags=["llms"])


@router.get("", response_model=List[LLMConfigRead])
def list_llms(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[LLMConfigRead]:
    configs = session.exec(
        select(LLMConfig)
        .where(LLMConfig.org_id == context.organization.id)
        .order_by(LLMConfig.created_at.desc())
    ).all()
    return [llm_to_read(config) for config in configs]


@router.get("/{config_id}", response_model=LLMConfigRead)
def get_llm(
    config_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> LLMConfigRead:
    config = get_llm_or_404(session, config_id, context.organization.id)
    return llm_to_read(config)


@router.post("", response_model=LLMConfigRead)
def create_llm(
    payload: LLMConfigCreate,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> LLMConfigRead:
    config_id = payload.id or new_id("llm")
    if session.get(LLMConfig, config_id):
        raise HTTPException(status_code=409, detail="LLM 配置 ID 已存在")
    try:
        config = llm_from_create(config_id, payload, org_id=context.organization.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.add(config)
    session.commit()
    session.refresh(config)
    return llm_to_read(config)


@router.put("/{config_id}", response_model=LLMConfigRead)
def update_llm(
    config_id: str,
    payload: LLMConfigUpdate,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> LLMConfigRead:
    config = get_llm_or_404(session, config_id, context.organization.id)

    updates = payload.model_dump(exclude_unset=True)
    if "api_key" in updates and updates["api_key"] == "":
        updates.pop("api_key")
    elif "api_key" in updates:
        updates["api_key"] = encrypt_secret(updates["api_key"])
    next_available_models = (
        [m.model_dump() for m in payload.available_models or []]
        if "available_models" in payload.model_fields_set
        else _loads(config.available_models_json, [])
    )
    if "available_models" in updates:
        updates.pop("available_models")
    if "extra_headers" in updates:
        try:
            reject_sensitive_headers(payload.extra_headers or {}, path="extra_headers")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        config.extra_headers_json = _dumps(payload.extra_headers or {})
        updates.pop("extra_headers")
    next_provider_type = updates.get("provider_type", config.provider_type)
    next_base_url = updates.get("base_url", config.base_url)
    try:
        normalized_provider_type, normalized_base_url = validate_llm_provider_contract(next_provider_type, next_base_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    next_default_model = updates.get("default_model", config.default_model)
    try:
        updates["default_model"] = validate_default_model(next_default_model, next_available_models)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if "available_models" in payload.model_fields_set:
        config.available_models_json = _dumps(next_available_models)
    if "provider_type" in updates:
        updates["provider_type"] = normalized_provider_type
    if "base_url" in updates or "provider_type" in updates:
        updates["base_url"] = normalized_base_url
    for key, value in updates.items():
        setattr(config, key, value)
    config.updated_at = now_iso()
    session.add(config)
    session.commit()
    session.refresh(config)
    return llm_to_read(config)


@router.post("/{config_id}/check", response_model=LLMCheckRead)
async def check_llm(
    config_id: str,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> LLMCheckRead:
    config = get_llm_or_404(session, config_id, context.organization.id)
    checked_at = now_iso()
    try:
        content = await probe_chat_model(config)
        message = content[:180] or "模型已响应"
        config.last_check_status = "healthy"
        config.last_check_message = message
    except Exception as exc:
        config.last_check_status = "failed"
        config.last_check_message = str(exc)[:500]
    config.last_checked_at = checked_at
    config.updated_at = checked_at
    session.add(config)
    session.commit()
    return LLMCheckRead(
        id=config.id,
        status=config.last_check_status,
        message=config.last_check_message,
        checked_at=checked_at,
    )


@router.delete("/{config_id}")
def delete_llm(
    config_id: str,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> Dict[str, str]:
    config = get_llm_or_404(session, config_id, context.organization.id)
    usage = llm_deletion_usage(config_id, session, context.organization.id)
    if usage.total:
        raise HTTPException(status_code=409, detail=llm_deletion_usage_detail(usage))
    session.delete(config)
    session.commit()
    return {"status": "deleted"}
