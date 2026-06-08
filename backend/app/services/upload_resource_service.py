from pathlib import Path

from sqlmodel import Session, select

from app.config import settings
from app.core.models import Upload


def upload_resource_dir(org_id: str, resource_type: str, resource_id: str | None = None) -> Path:
    parts = [settings.upload_dir, org_id, resource_type]
    if resource_id:
        parts.append(resource_id)
    return Path(*map(str, parts))


def build_upload_target(
    *,
    org_id: str,
    resource_type: str,
    resource_id: str | None,
    record_id: str,
    file_name: str,
) -> Path:
    target_dir = upload_resource_dir(org_id, resource_type, resource_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir / f"{record_id}_{safe_upload_name(file_name)}"


def safe_upload_name(file_name: str | None, fallback: str = "upload.txt") -> str:
    cleaned = Path(file_name or fallback).name.strip()
    return cleaned or fallback


def list_conversation_uploads(session: Session, org_id: str, conversation_id: str) -> list[Upload]:
    return list(
        session.exec(
            select(Upload).where(
                Upload.org_id == org_id,
                Upload.conversation_id == conversation_id,
            )
        ).all()
    )


def safe_unlink_upload(file_path: str) -> int:
    try:
        root = settings.upload_dir.resolve()
        target = Path(file_path).resolve()
    except (OSError, RuntimeError):
        return 0
    if not _is_relative_to(target, root) or not target.exists():
        return 0
    try:
        target.unlink(missing_ok=True)
    except OSError:
        return 0
    return 1


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True
