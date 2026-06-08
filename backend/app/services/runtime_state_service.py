import sqlite3
from pathlib import Path
from typing import Any

from app.config import settings
from app.services.runtime_adapter.state_store import (
    mask_connection_url,
    postgres_runtime_package_available,
    runtime_state_config_warnings,
    runtime_state_postgres_dsn,
)


def runtime_state_stats() -> dict[str, int]:
    root = settings.runtime_state_dir
    checkpoint_db = root / "checkpoints.sqlite"
    store_db = root / "store.sqlite"
    return {
        "runtime_state_bytes": _path_bytes(root),
        "checkpoint_bytes": _sqlite_family_bytes(checkpoint_db),
        "store_bytes": _sqlite_family_bytes(store_db),
        "checkpoints": _sqlite_count(checkpoint_db, "checkpoints"),
        "checkpoint_writes": _sqlite_count(checkpoint_db, "writes"),
        "store_items": _sqlite_count(store_db, "store"),
    }


def runtime_state_snapshot() -> dict[str, Any]:
    root = settings.runtime_state_dir
    stats = runtime_state_stats()
    backend = settings.runtime_state_backend
    warnings = runtime_state_config_warnings()
    if stats["runtime_state_bytes"] > 1024 * 1024 * 1024:
        warnings.append("运行态文件超过 1GB，建议安排离峰清理和备份。")
    if stats["checkpoint_writes"] > 100_000:
        warnings.append("检查点写入量较高，建议评估按租户配额和压缩策略。")
    status = "warning" if warnings else "healthy"
    return {
        "backend": backend,
        "state_dir": str(root),
        "checkpoint_db": _checkpoint_location(root, backend),
        "store_db": _store_location(root, backend),
        "checkpoint_exists": _checkpoint_exists(root, backend),
        "store_exists": _store_exists(root, backend),
        "status": status,
        "warnings": warnings,
        "postgres_package_available": postgres_runtime_package_available() if backend == "postgres" else None,
        **stats,
    }


def _path_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            total += item.stat().st_size
    return total


def _sqlite_family_bytes(path: Path) -> int:
    return sum(_path_bytes(Path(f"{path}{suffix}")) for suffix in ("", "-wal", "-shm"))


def _sqlite_count(path: Path, table: str) -> int:
    if not path.exists():
        return 0
    try:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
            row: Any = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()
    except sqlite3.Error:
        return 0
    return int(row[0] or 0) if row else 0


def _checkpoint_location(root: Path, backend: str) -> str:
    if backend == "postgres":
        return mask_connection_url(runtime_state_postgres_dsn())
    return str(root / "checkpoints.sqlite")


def _store_location(root: Path, backend: str) -> str:
    if backend == "postgres":
        return mask_connection_url(runtime_state_postgres_dsn())
    return str(root / "store.sqlite")


def _checkpoint_exists(root: Path, backend: str) -> bool:
    if backend == "postgres":
        return postgres_runtime_package_available() and bool(runtime_state_postgres_dsn())
    return (root / "checkpoints.sqlite").exists()


def _store_exists(root: Path, backend: str) -> bool:
    if backend == "postgres":
        return postgres_runtime_package_available() and bool(runtime_state_postgres_dsn())
    return (root / "store.sqlite").exists()
