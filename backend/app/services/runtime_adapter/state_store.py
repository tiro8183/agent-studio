import asyncio
import contextlib
import importlib
import importlib.util
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiosqlite
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.store.memory import InMemoryStore
from langgraph.store.sqlite.aio import AsyncSqliteStore

from app.config import settings

_CHECKPOINTERS: dict[str, Any] = {}
_STORES: dict[str, Any] = {}
_SQLITE_CONNECTIONS: list[aiosqlite.Connection] = []
_POSTGRES_CONTEXTS: list[Any] = []
_RUNTIME_STATE_LOCK: asyncio.Lock | None = None


def runtime_state_postgres_dsn() -> str:
    value = (settings.runtime_state_postgres_url or settings.database_url).strip()
    if value.startswith("postgresql+psycopg://"):
        return value.replace("postgresql+psycopg://", "postgresql://", 1)
    if value.startswith("postgres+psycopg://"):
        return value.replace("postgres+psycopg://", "postgresql://", 1)
    return value


def runtime_state_config_warnings() -> list[str]:
    backend = settings.runtime_state_backend
    warnings: list[str] = []
    if backend == "memory":
        warnings.append("当前使用内存运行态，仅适合本地临时调试。")
    if backend == "postgres":
        dsn = runtime_state_postgres_dsn()
        if not dsn:
            warnings.append("Postgres 运行态后端未配置连接地址。")
        elif not dsn.startswith(("postgresql://", "postgres://")):
            warnings.append("Postgres 运行态后端需要 postgresql:// 连接地址。")
        if not postgres_runtime_package_available():
            warnings.append("Postgres 运行态后端缺少 langgraph-checkpoint-postgres 依赖。")
    if settings.env in {"staging", "production"} and backend != "postgres":
        warnings.append("共享或生产环境应使用 Postgres 运行态后端。")
    return warnings


def runtime_state_config_evidence() -> dict[str, Any]:
    evidence: dict[str, Any] = {
        "backend": settings.runtime_state_backend,
        "state_dir": str(settings.runtime_state_dir),
    }
    if settings.runtime_state_backend == "postgres":
        evidence.update(
            {
                "postgres_url": mask_connection_url(runtime_state_postgres_dsn()),
                "postgres_package_available": postgres_runtime_package_available(),
            }
        )
    return evidence


def postgres_runtime_package_available() -> bool:
    for module in ("langgraph.checkpoint.postgres.aio", "langgraph.store.postgres.aio"):
        try:
            if importlib.util.find_spec(module) is None:
                return False
        except ModuleNotFoundError:
            return False
    return True


def mask_connection_url(value: str) -> str:
    if not value:
        return ""
    try:
        parsed = urlsplit(value)
    except ValueError:
        return "***"
    if not parsed.scheme or not parsed.netloc:
        return value
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    username = parsed.username or ""
    auth = f"{username}:***@" if username else ""
    return urlunsplit((parsed.scheme, f"{auth}{host}{port}", parsed.path, "", ""))


async def get_checkpointer(runtime_state_key: str):
    backend = settings.runtime_state_backend
    if backend == "memory":
        return _CHECKPOINTERS.setdefault(runtime_state_key, MemorySaver())
    if backend == "sqlite":
        return await _sqlite_checkpointer()
    if backend == "postgres":
        return await _postgres_checkpointer()
    raise RuntimeError(f"不支持的运行态后端: {backend}")


async def get_store(runtime_state_key: str):
    backend = settings.runtime_state_backend
    if backend == "memory":
        return _STORES.setdefault(runtime_state_key, InMemoryStore())
    if backend == "sqlite":
        return await _sqlite_store()
    if backend == "postgres":
        return await _postgres_store()
    raise RuntimeError(f"不支持的运行态后端: {backend}")


async def close_runtime_state() -> None:
    for store in _STORES.values():
        task = getattr(store, "_task", None)
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        stop_ttl_sweeper = getattr(store, "stop_ttl_sweeper", None)
        if stop_ttl_sweeper:
            await _maybe_await(stop_ttl_sweeper())
    for context in reversed(_POSTGRES_CONTEXTS):
        await context.__aexit__(None, None, None)
    for conn in _SQLITE_CONNECTIONS:
        await conn.close()
    _CHECKPOINTERS.clear()
    _STORES.clear()
    _POSTGRES_CONTEXTS.clear()
    _SQLITE_CONNECTIONS.clear()
    global _RUNTIME_STATE_LOCK
    _RUNTIME_STATE_LOCK = None


def _runtime_state_lock() -> asyncio.Lock:
    global _RUNTIME_STATE_LOCK
    if _RUNTIME_STATE_LOCK is None:
        _RUNTIME_STATE_LOCK = asyncio.Lock()
    return _RUNTIME_STATE_LOCK


def _runtime_state_path(name: str) -> Path:
    settings.runtime_state_dir.mkdir(parents=True, exist_ok=True)
    return settings.runtime_state_dir / name


async def _sqlite_connection(path: Path, *, autocommit: bool = False) -> aiosqlite.Connection:
    kwargs = {"isolation_level": None} if autocommit else {}
    conn = aiosqlite.connect(str(path), **kwargs)
    await conn
    _SQLITE_CONNECTIONS.append(conn)
    return conn


async def _sqlite_checkpointer():
    key = "sqlite"
    async with _runtime_state_lock():
        if key not in _CHECKPOINTERS:
            conn = await _sqlite_connection(_runtime_state_path("checkpoints.sqlite"))
            saver = AsyncSqliteSaver(conn)
            await saver.setup()
            _CHECKPOINTERS[key] = saver
    return _CHECKPOINTERS[key]


async def _sqlite_store():
    key = "sqlite"
    async with _runtime_state_lock():
        if key not in _STORES:
            conn = await _sqlite_connection(_runtime_state_path("store.sqlite"), autocommit=True)
            store = AsyncSqliteStore(conn)
            await store.setup()
            _STORES[key] = store
    return _STORES[key]


async def _postgres_checkpointer():
    key = "postgres"
    async with _runtime_state_lock():
        if key not in _CHECKPOINTERS:
            saver_class = _postgres_class("langgraph.checkpoint.postgres.aio", "AsyncPostgresSaver")
            saver = await _enter_from_conn_string(saver_class, runtime_state_postgres_dsn())
            await _maybe_await(saver.setup())
            _CHECKPOINTERS[key] = saver
    return _CHECKPOINTERS[key]


async def _postgres_store():
    key = "postgres"
    async with _runtime_state_lock():
        if key not in _STORES:
            store_class = _postgres_class("langgraph.store.postgres.aio", "AsyncPostgresStore")
            store = await _enter_from_conn_string(store_class, runtime_state_postgres_dsn())
            await _maybe_await(store.setup())
            _STORES[key] = store
    return _STORES[key]


def _postgres_class(module_name: str, class_name: str):
    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "当前配置启用了 Postgres 运行态后端，但缺少 langgraph-checkpoint-postgres 依赖。"
        ) from exc
    return getattr(module, class_name)


async def _enter_from_conn_string(factory_class, dsn: str):
    if not dsn.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("Postgres 运行态后端需要配置 postgresql:// 连接地址。")
    from_conn_string = getattr(factory_class, "from_conn_string", None)
    if from_conn_string is None:
        raise RuntimeError(f"{factory_class.__name__} 不支持 from_conn_string 初始化。")
    context = from_conn_string(dsn)
    value = await context.__aenter__()
    _POSTGRES_CONTEXTS.append(context)
    return value


async def _maybe_await(value):
    if hasattr(value, "__await__"):
        return await value
    return value
