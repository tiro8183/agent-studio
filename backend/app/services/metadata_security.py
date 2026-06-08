import re
from typing import Any


TEXT_SECRET_PATTERNS = (
    re.compile(r"(?i)(\bauthorization\b\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;}\]]+"),
    re.compile(
        r"""(?i)(["']?(?:api[_-]?key|authorization|client[_-]?secret|password|secret|token)["']?\s*[:=]\s*["']?)([^"',\s;}\]]+)"""
    ),
    re.compile(
        r"(?i)(\b(?:api[_-]?key|authorization|client[_-]?secret|password|secret|token)\b\s*[:=]\s*)([^\s,;}\]]+)"
    ),
    re.compile(r"(?i)(\bBearer\s+)([A-Za-z0-9._~+/=-]{8,})"),
    re.compile(r"(?i)(\bBasic\s+)([A-Za-z0-9+/=-]{8,})"),
)
SENSITIVE_METADATA_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "password",
    "secret",
    "token",
    "value",
}
SECRET_REF_SECTIONS = {"secret_headers", "secret_env"}


def metadata_for_read(metadata: dict[str, Any]) -> dict[str, Any]:
    return redact_sensitive_metadata(metadata)


def metadata_for_snapshot(metadata: dict[str, Any]) -> dict[str, Any]:
    return redact_sensitive_metadata(metadata)


def redact_sensitive_metadata(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if key_text in SECRET_REF_SECTIONS:
                redacted[key_text] = _redact_secret_ref_section(item)
            elif _is_sensitive_key(key_text):
                redacted[key_text] = "***"
            else:
                redacted[key_text] = redact_sensitive_metadata(item)
        return redacted
    if isinstance(value, list):
        return [redact_sensitive_metadata(item) for item in value]
    return value


def redact_sensitive_text(value: str) -> str:
    redacted = value
    for pattern in TEXT_SECRET_PATTERNS:
        redacted = pattern.sub(r"\1***", redacted)
    return redacted


def reject_inline_secret_metadata(metadata: dict[str, Any]) -> None:
    _reject_inline_secret_metadata(metadata, path=[])


def reject_sensitive_headers(headers: dict[str, Any], *, path: str = "headers") -> None:
    for name, value in headers.items():
        name_text = str(name)
        if _is_sensitive_key(name_text) and _has_inline_value(value):
            raise ValueError(f"{path}.{name_text} 含敏感值，请改用密钥托管或 secret_headers 引用")


def _reject_inline_secret_metadata(value: Any, path: list[str]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            key_text = str(key)
            next_path = [*path, key_text]
            if key_text in SECRET_REF_SECTIONS:
                if not isinstance(item, dict):
                    raise ValueError(f"{'.'.join(next_path)} 必须是 JSON 对象")
                for ref_name, secret_id in item.items():
                    if not str(ref_name).strip() or not str(secret_id).strip():
                        raise ValueError(f"{'.'.join([*next_path, str(ref_name)])} 必须引用有效密钥 ID")
                continue
            if key_text in {"headers", "env"} and isinstance(item, dict):
                reject_sensitive_headers(item, path=".".join(next_path))
            if _is_sensitive_key(key_text) and _has_inline_value(item):
                raise ValueError(f"{'.'.join(next_path)} 含敏感值，请改用 ToolSecret 引用")
            _reject_inline_secret_metadata(item, next_path)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _reject_inline_secret_metadata(item, [*path, str(index)])


def _has_inline_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (dict, list)):
        return bool(value)
    return True


def _redact_secret_ref_section(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    return {str(key): str(secret_id) for key, secret_id in value.items() if str(key).strip()}


def _is_sensitive_key(key: str) -> bool:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", key).strip("_").lower()
    if normalized in SENSITIVE_METADATA_KEYS:
        return True
    return normalized.endswith(("_api_key", "_authorization", "_client_secret", "_password", "_secret", "_token"))
