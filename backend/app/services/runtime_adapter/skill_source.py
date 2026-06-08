import re
from pathlib import Path
from typing import Any

from app.core.models import Skill
from app.services.mappers import _dumps
from app.services.runtime_adapter.compiled_plan import CompiledRuntimePlan
from app.services.skill_service import write_skill_files


def skill_source_paths_from_plan(plan: CompiledRuntimePlan, root: Path) -> tuple[list[str], dict[str, list[str]]]:
    main_skills = [_snapshot_skill(snapshot) for snapshot in _resource_snapshots(plan.main_skills) if snapshot.get("status") == "active"]
    subagent_sources = {
        str(subagent.get("name") or ""): _write_skill_source(
            root,
            Path("skills") / "subagents" / _safe_source_name(str(subagent.get("name") or "")),
            [
                _snapshot_skill(snapshot)
                for snapshot in _resource_snapshots(list(subagent.get("skills") or []))
                if snapshot.get("status") == "active"
            ],
        )
        for subagent in plan.subagents
        if subagent.get("name")
    }
    return _write_skill_source(root, Path("skills") / "main", main_skills), subagent_sources


def _write_skill_source(root: Path, relative_path: Path, skills: list[Skill]) -> list[str]:
    if not skills:
        return []
    skills_root = write_skill_files(skills, root=root / relative_path, clean=True)
    return ["/" + skills_root.relative_to(root).as_posix()]


def _snapshot_skill(item: dict[str, Any]) -> Skill:
    return Skill(
        id=str(item.get("id") or ""),
        org_id=str(item.get("org_id") or "org_default"),
        name=str(item.get("name") or ""),
        display_name=str(item.get("display_name") or item.get("name") or ""),
        description=str(item.get("description") or ""),
        instructions=str(item.get("instructions") or ""),
        allowed_tools_json=_dumps(item.get("allowed_tools") or []),
        metadata_json=_dumps(item.get("metadata") or {}),
        version=int(item.get("version") or 1),
        status=str(item.get("status") or "inactive"),
    )


def _resource_snapshots(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = []
    for resource in resources:
        metadata = resource.get("metadata") or {}
        if not isinstance(metadata, dict):
            continue
        snapshot = metadata.get("snapshot")
        if isinstance(snapshot, dict):
            snapshots.append(snapshot)
    return snapshots


def _safe_source_name(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
    return normalized or "subagent"
