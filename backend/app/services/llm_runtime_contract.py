from typing import Any

from app.core.models import LLMConfig
from app.services.llm_provider_policy import normalize_base_url, normalize_provider_type
from app.services.mappers import _dumps, _loads


def snapshot_llm_config(row: LLMConfig) -> dict[str, Any]:
    return {
        "id": row.id,
        "org_id": row.org_id,
        "name": row.name,
        "provider_type": normalize_provider_type(row.provider_type),
        "api_key_ref": row.id,
        "base_url": normalize_base_url(row.base_url),
        "available_models": _loads(row.available_models_json, []),
        "default_model": row.default_model,
        "temperature": row.temperature,
        "max_tokens": row.max_tokens,
        "extra_headers": _loads(row.extra_headers_json, {}),
        "status": row.status,
    }


def find_llm_contract(
    llm_contracts: list[dict[str, Any]],
    llm_config_id: str | None,
) -> dict[str, Any] | None:
    target_id = str(llm_config_id or "").strip()
    if not target_id:
        return None
    for item in llm_contracts:
        if str(item.get("id") or "") == target_id:
            return item
    return None


def llm_config_from_contract(
    item: dict[str, Any],
    *,
    org_id: str,
    default_model: str = "",
    api_key: str = "",
) -> LLMConfig:
    return LLMConfig(
        id=str(item.get("id") or ""),
        org_id=str(item.get("org_id") or org_id),
        name=str(item.get("name") or ""),
        provider_type=normalize_provider_type(str(item.get("provider_type") or "custom")),
        api_key=api_key,
        base_url=normalize_base_url(item.get("base_url")),
        available_models_json=_dumps(item.get("available_models") or []),
        default_model=str(item.get("default_model") or default_model),
        temperature=float(item.get("temperature") if item.get("temperature") is not None else 0.7),
        max_tokens=int(item.get("max_tokens") or 4096),
        extra_headers_json=_dumps(item.get("extra_headers") or {}),
        status=str(item.get("status") or "inactive"),
    )
