import re
from typing import Optional

OFFICIAL_PROVIDER_TYPES = {"openai", "anthropic", "google"}
PROVIDER_TYPE_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


def normalize_provider_type(value: str | None) -> str:
    provider_type = str(value or "").strip().lower()
    if not provider_type:
        raise ValueError("通道标识不能为空")
    if not PROVIDER_TYPE_RE.fullmatch(provider_type):
        raise ValueError("通道标识仅支持小写字母、数字、点、下划线和短横线，且不能超过 64 个字符")
    return provider_type


def normalize_base_url(value: Optional[str]) -> Optional[str]:
    text = str(value or "").strip().rstrip("/")
    return text or None


def provider_requires_base_url(provider_type: str) -> bool:
    return provider_type not in OFFICIAL_PROVIDER_TYPES


def validate_llm_provider_contract(provider_type: str | None, base_url: Optional[str]) -> tuple[str, Optional[str]]:
    normalized_provider = normalize_provider_type(provider_type)
    normalized_base_url = normalize_base_url(base_url)
    if provider_requires_base_url(normalized_provider) and not normalized_base_url:
        raise ValueError("标准模型接口或自定义厂商需要填写 Base URL")
    return normalized_provider, normalized_base_url


def provider_protocol_label(provider_type: str) -> str:
    normalized_provider = normalize_provider_type(provider_type)
    if normalized_provider == "anthropic":
        return "anthropic"
    if normalized_provider == "google":
        return "google"
    return "openai-compatible"


def available_model_names(available_models: list[object]) -> set[str]:
    names: set[str] = set()
    for item in available_models:
        name = ""
        if isinstance(item, dict):
            name = str(item.get("name") or "").strip()
        elif hasattr(item, "name"):
            name = str(getattr(item, "name") or "").strip()
        if name:
            names.add(name)
    return names


def validate_default_model(default_model: str | None, available_models: list[object]) -> str:
    model = str(default_model or "").strip()
    if not model:
        raise ValueError("默认模型不能为空")
    model_names = available_model_names(available_models)
    if not model_names:
        raise ValueError("可调用模型不能为空")
    if model not in model_names:
        raise ValueError("默认模型必须出现在可调用模型列表中")
    return model


def validate_model_binding(model: str | None, available_models: list[object], *, label: str = "模型") -> str:
    selected = str(model or "").strip()
    if not selected:
        raise ValueError(f"{label}不能为空")
    model_names = available_model_names(available_models)
    if model_names and selected not in model_names:
        raise ValueError(f"{label}必须来自所选模型通道的可调用模型列表")
    return selected
