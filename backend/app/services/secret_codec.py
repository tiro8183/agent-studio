import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


SECRET_PREFIX = "afsec:v1:"
DEFAULT_SECRET_KEY = "agent-forge-local-development-secret"


class SecretSettingsError(RuntimeError):
    pass


def is_default_secret_key(value: str | None = None) -> bool:
    key = (settings.secret_key if value is None else value).strip()
    return not key or key == DEFAULT_SECRET_KEY


def validate_secret_settings() -> None:
    if settings.env == "production" and is_default_secret_key():
        raise SecretSettingsError("生产环境必须配置 AGENT_FORGE_SECRET_KEY，不能使用本地开发默认密钥")


def secret_readiness() -> dict[str, str | bool]:
    default_key = is_default_secret_key()
    ready = not (settings.env == "production" and default_key)
    return {
        "key": "secret_key",
        "ready": ready,
        "environment": settings.env,
        "default_key": default_key,
        "message": "密钥配置可用" if ready else "生产环境必须配置 AGENT_FORGE_SECRET_KEY",
    }


def _fernet() -> Fernet:
    key_material = settings.secret_key.strip() or DEFAULT_SECRET_KEY
    digest = hashlib.sha256(key_material.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def is_encrypted_secret(value: str | None) -> bool:
    return bool(value and value.startswith(SECRET_PREFIX))


def encrypt_secret(value: str | None) -> str:
    if not value:
        return ""
    if is_encrypted_secret(value):
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{SECRET_PREFIX}{token}"


def decrypt_secret(value: str | None) -> str:
    if not value:
        return ""
    if not is_encrypted_secret(value):
        return value
    token = value[len(SECRET_PREFIX):].encode("ascii")
    try:
        return _fernet().decrypt(token).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("密钥无法解密，请检查 AGENT_FORGE_SECRET_KEY 配置") from exc


def secret_configured(value: str | None) -> bool:
    return bool(decrypt_secret(value).strip()) if value else False
