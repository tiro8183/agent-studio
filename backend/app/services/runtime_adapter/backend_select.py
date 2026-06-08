from pathlib import Path
from typing import Any

from deepagents.backends.filesystem import FilesystemBackend
from deepagents.backends.state import StateBackend
from deepagents.backends.store import StoreBackend
from deepagents.middleware.filesystem import FilesystemPermission

from app.services.runtime_adapter.compiled_plan import CompiledRuntimePlan


def permissions_from_config_dict(config: dict[str, Any]) -> list[FilesystemPermission]:
    read_paths = list(config.get("allowed_paths") or ["/workspace/**", "/skills/**"])
    allow_write = bool(config.get("allow_write"))
    rules = [
        FilesystemPermission(operations=["read"], paths=read_paths, mode="allow"),
        FilesystemPermission(operations=["read"], paths=["/**"], mode="deny"),
    ]
    if allow_write:
        write_paths = [path for path in read_paths if not str(path).startswith("/skills")]
        rules.extend(
            [
                FilesystemPermission(
                    operations=["write"],
                    paths=write_paths or ["/workspace/**"],
                    mode="allow",
                ),
                FilesystemPermission(operations=["write"], paths=["/**"], mode="deny"),
            ]
        )
    else:
        rules.append(FilesystemPermission(operations=["write"], paths=["/**"], mode="deny"))
    return rules


def permissions_from_plan(plan: CompiledRuntimePlan) -> list[FilesystemPermission]:
    permissions = dict(plan.permissions or {})
    filesystem = dict(plan.filesystem or {})
    if filesystem.get("read_only"):
        permissions["allow_write"] = False
    return permissions_from_config_dict(permissions)


def store_namespace(runtime_state_key: str) -> tuple[str, str]:
    return (runtime_state_key, "filesystem")


async def sync_skill_sources_to_store(runtime_state_key: str, root: Path, sources: list[str], store) -> None:
    for source in sources:
        source_root = root / source.lstrip("/")
        if not source_root.exists():
            continue
        for path in source_root.rglob("SKILL.md"):
            relative_path = "/" + path.relative_to(root).as_posix()
            await store.aput(
                store_namespace(runtime_state_key),
                relative_path,
                {
                    "content": path.read_text(encoding="utf-8"),
                    "encoding": "utf-8",
                },
            )


async def backend_from_plan(
    plan: CompiledRuntimePlan,
    root: Path,
    *,
    needs_filesystem: bool,
    skill_sources: list[str],
    subagent_skill_sources: dict[str, list[str]],
    store,
    runtime_state_key: str,
):
    if plan.backend_type == "store":
        await sync_skill_sources_to_store(
            runtime_state_key,
            root,
            [*skill_sources, *[source for sources in subagent_skill_sources.values() for source in sources]],
            store,
        )
        return StoreBackend(
            store=store,
            namespace=lambda _: store_namespace(runtime_state_key),
        )
    if plan.backend_type == "state" and not needs_filesystem:
        return StateBackend()
    if bool(plan.filesystem.get("enabled", True)) or needs_filesystem:
        return FilesystemBackend(root_dir=root, virtual_mode=True)
    return None
