import json
import shutil
from pathlib import Path
from typing import Iterable, List

from sqlmodel import Session, select

from app.config import settings
from app.core.models import Agent, Skill, SkillVersion, ToolDefinition, new_id, now_iso
from app.core.schemas import (
    RuntimeResourceRead,
    SkillAgentBindingRead,
    SkillChangeRead,
    SkillExportRead,
    SkillImpactRead,
    SkillImportPreviewRead,
    SkillRead,
    SkillRuntimePreviewRead,
    SkillVersionDiffRead,
    SkillVersionRead,
)
from app.services.mappers import _dumps, _loads
from app.services.tenant_scope import visible_tool_filter
from app.services.tool_registry import validate_tool_bindings


def skill_to_read(skill: Skill) -> SkillRead:
    return SkillRead(
        id=skill.id,
        org_id=skill.org_id,
        name=skill.name,
        display_name=skill.display_name,
        description=skill.description,
        instructions=skill.instructions,
        allowed_tools=_loads(skill.allowed_tools_json, []),
        metadata=_loads(skill.metadata_json, {}),
        version=skill.version,
        status=skill.status,
        created_at=skill.created_at,
        updated_at=skill.updated_at,
    )


def version_to_read(version: SkillVersion) -> SkillVersionRead:
    return SkillVersionRead(
        id=version.id,
        org_id=version.org_id,
        skill_id=version.skill_id,
        name=version.name,
        display_name=version.display_name,
        description=version.description,
        instructions=version.instructions,
        allowed_tools=_loads(version.allowed_tools_json, []),
        metadata=_loads(version.metadata_json, {}),
        version=version.version,
        status=version.status,
        created_at=version.created_at,
    )


def list_skill_versions(session: Session, skill_id: str, org_id: str) -> list[SkillVersionRead]:
    rows = session.exec(
        select(SkillVersion)
        .where(SkillVersion.skill_id == skill_id, SkillVersion.org_id == org_id)
        .order_by(SkillVersion.version.desc())
    ).all()
    return [version_to_read(row) for row in rows]


def publish_skill_version(session: Session, skill: Skill) -> SkillVersionRead:
    latest = session.exec(
        select(SkillVersion)
        .where(SkillVersion.skill_id == skill.id, SkillVersion.org_id == skill.org_id)
        .order_by(SkillVersion.version.desc())
        .limit(1)
    ).first()
    if latest and _same_snapshot(skill, latest):
        return version_to_read(latest)
    version = SkillVersion(
        id=new_id("skillver"),
        org_id=skill.org_id,
        skill_id=skill.id,
        version=skill.version,
        name=skill.name,
        display_name=skill.display_name,
        description=skill.description,
        instructions=skill.instructions,
        allowed_tools_json=skill.allowed_tools_json,
        metadata_json=skill.metadata_json,
        status=skill.status,
    )
    session.add(version)
    session.commit()
    session.refresh(version)
    return version_to_read(version)


def restore_skill_version(session: Session, skill: Skill, version: SkillVersion) -> SkillRead:
    skill.display_name = version.display_name
    skill.description = version.description
    skill.instructions = version.instructions
    skill.allowed_tools_json = version.allowed_tools_json
    skill.metadata_json = version.metadata_json
    skill.status = version.status
    skill.version += 1
    skill.updated_at = now_iso()
    session.add(skill)
    session.commit()
    session.refresh(skill)
    return skill_to_read(skill)


def export_skill_package(session: Session, skill: Skill) -> SkillExportRead:
    return SkillExportRead(
        skill=skill_to_read(skill),
        versions=list_skill_versions(session, skill.id, skill.org_id),
    )


def import_skill_package(
    session: Session,
    package: dict,
    overwrite: bool = False,
    preserve_id: bool = False,
    org_id: str = "org_default",
    actor_role: str = "owner",
) -> SkillRead:
    skill_data = _skill_data_from_package(package)
    name = str(skill_data.get("name") or "").strip()
    validate_allowed_tools(
        session,
        [str(item) for item in skill_data.get("allowed_tools") or [] if item],
        org_id,
        actor_role,
    )
    existing = session.exec(select(Skill).where(Skill.name == name, Skill.org_id == org_id)).first()
    if existing and not overwrite:
        raise ValueError("能力名称已存在；如需覆盖请启用 overwrite")

    skill_id = str(skill_data.get("id") or "").strip() if preserve_id else ""
    existing_by_id = session.get(Skill, skill_id) if skill_id else None
    if existing_by_id and existing_by_id.org_id != org_id:
        raise ValueError("能力 ID 已被其他组织占用")
    if not skill_id or (existing_by_id and not existing):
        skill_id = existing.id if existing else new_id("skill")

    values = {
        "id": skill_id,
        "org_id": org_id,
        "name": name,
        "display_name": str(skill_data.get("display_name") or name),
        "description": str(skill_data.get("description") or ""),
        "instructions": str(skill_data.get("instructions") or ""),
        "allowed_tools_json": _dumps(skill_data.get("allowed_tools") or []),
        "metadata_json": _dumps(skill_data.get("metadata") or {}),
        "status": str(skill_data.get("status") or "active"),
        "version": int(skill_data.get("version") or (existing.version if existing else 1) or 1),
    }
    row = existing or Skill(**values)
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = now_iso()
    session.add(row)
    session.commit()
    session.refresh(row)

    imported_versions = package.get("versions") if isinstance(package, dict) else []
    if isinstance(imported_versions, list):
        _replace_imported_versions(session, row, imported_versions, actor_role)
    return skill_to_read(row)


def validate_allowed_tools(
    session: Session,
    tool_ids: list[str],
    org_id: str,
    actor_role: str,
) -> None:
    validate_tool_bindings(session, tool_ids, org_id, actor_role, label="能力")


def preview_skill_import(session: Session, package: dict, org_id: str = "org_default") -> SkillImportPreviewRead:
    skill_data = _skill_data_from_package(package)
    name = str(skill_data.get("name") or "").strip()
    existing = session.exec(select(Skill).where(Skill.name == name, Skill.org_id == org_id)).first()
    allowed_tools = [str(item) for item in skill_data.get("allowed_tools") or [] if item]
    missing_tools, inactive_tools = _tool_health(session, allowed_tools, org_id)
    imported_versions = package.get("versions") if isinstance(package, dict) else []
    changes = _skill_changes(existing, skill_data) if existing else []
    warnings: list[str] = []
    if missing_tools:
        warnings.append("导入包引用了未注册工具。")
    if inactive_tools:
        warnings.append("导入包引用了未启用工具。")
    if existing:
        warnings.append("导入会覆盖同名能力，建议先确认影响分析。")
    return SkillImportPreviewRead(
        name=name,
        action="overwrite" if existing else "create",
        existing_skill_id=existing.id if existing else None,
        incoming_version=int(skill_data.get("version") or 1),
        imported_versions=len(imported_versions) if isinstance(imported_versions, list) else 0,
        missing_tools=missing_tools,
        inactive_tools=inactive_tools,
        changes=changes,
        warnings=warnings,
    )


def diff_skill_version(session: Session, skill: Skill, version: SkillVersion) -> SkillVersionDiffRead:
    return SkillVersionDiffRead(
        skill_id=skill.id,
        version=version.version,
        changes=_skill_changes(skill, {
            "display_name": version.display_name,
            "description": version.description,
            "instructions": version.instructions,
            "allowed_tools": _loads(version.allowed_tools_json, []),
            "metadata": _loads(version.metadata_json, {}),
            "status": version.status,
        }),
    )


def list_active_skills(session: Session, skill_ids: Iterable[str], org_id: str) -> List[Skill]:
    ids = [skill_id for skill_id in skill_ids if skill_id]
    if not ids:
        return []
    return session.exec(
        select(Skill).where(Skill.id.in_(ids), Skill.org_id == org_id, Skill.status == "active")
    ).all()


def write_skill_files(skills: List[Skill], root: Path | None = None, clean: bool = False) -> Path:
    skills_root = root or settings.runtime_dir / "skills"
    if clean and skills_root.exists():
        shutil.rmtree(skills_root)
    skills_root.mkdir(parents=True, exist_ok=True)
    for skill in skills:
        skill_dir = skills_root / skill.name
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(render_skill_markdown(skill), encoding="utf-8")
    return skills_root


def render_skill_markdown(skill: Skill) -> str:
    allowed_tools = " ".join(_loads(skill.allowed_tools_json, []))
    metadata = _loads(skill.metadata_json, {})
    frontmatter = {
        "name": skill.name,
        "description": skill.description,
    }
    if allowed_tools:
        frontmatter["allowed-tools"] = allowed_tools
    if metadata:
        frontmatter["metadata"] = metadata
    skill_md = [
        "---",
        *_yaml_lines(frontmatter),
        "---",
        "",
        skill.instructions.strip(),
        "",
    ]
    return "\n".join(skill_md)


def skill_runtime_preview(session: Session, skill: Skill) -> SkillRuntimePreviewRead:
    allowed_tool_ids = _loads(skill.allowed_tools_json, [])
    tool_rows = (
        session.exec(
            select(ToolDefinition).where(
                ToolDefinition.id.in_(allowed_tool_ids),
                visible_tool_filter(skill.org_id),
            )
        ).all()
        if allowed_tool_ids
        else []
    )
    tool_map = {row.id: row for row in tool_rows}
    missing_tools = [tool_id for tool_id in allowed_tool_ids if tool_id not in tool_map]
    inactive_tools = [row.id for row in tool_rows if row.status != "active"]
    warnings: list[str] = []
    if missing_tools:
        warnings.append("能力包引用了未注册的工具，运行时不会获得这些工具。")
    if inactive_tools:
        warnings.append("能力包引用了未启用的工具，运行时会跳过这些工具。")
    if not skill.instructions.strip():
        warnings.append("执行规范为空，运行时不会提供有效行为指导。")
    return SkillRuntimePreviewRead(
        skill_id=skill.id,
        name=skill.name,
        markdown=render_skill_markdown(skill),
        allowed_tools=[
            RuntimeResourceRead(
                id=row.id,
                name=row.name,
                status=row.status,
                kind=row.implementation,
                metadata={"category": row.category},
            )
            for tool_id in allowed_tool_ids
            if (row := tool_map.get(tool_id))
        ],
        missing_tools=missing_tools,
        inactive_tools=inactive_tools,
        warnings=warnings,
    )


def skill_impact(session: Session, skill: Skill) -> SkillImpactRead:
    bindings: list[SkillAgentBindingRead] = []
    agents = session.exec(
        select(Agent)
        .where(Agent.org_id == skill.org_id)
        .order_by(Agent.updated_at.desc())
    ).all()
    for agent in agents:
        main_skills = _loads(agent.skills_json, [])
        if skill.id in main_skills:
            bindings.append(
                SkillAgentBindingRead(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    agent_status=agent.status,
                    binding="main",
                )
            )
        for subagent in _loads(agent.subagents_json, []):
            if skill.id in (subagent.get("skills") or []):
                bindings.append(
                    SkillAgentBindingRead(
                        agent_id=agent.id,
                        agent_name=agent.name,
                        agent_status=agent.status,
                        binding="subagent",
                        subagent_name=str(subagent.get("name") or ""),
                    )
                )
    agent_ids = {item.agent_id for item in bindings}
    published_agent_ids = {
        item.agent_id
        for item in bindings
        if item.agent_status == "published"
    }
    return SkillImpactRead(
        skill_id=skill.id,
        skill_name=skill.display_name or skill.name,
        total_agents=len(agent_ids),
        published_agents=len(published_agent_ids),
        bindings=bindings,
    )


def _skill_data_from_package(package: dict) -> dict:
    skill_data = package.get("skill") if isinstance(package, dict) else None
    if not isinstance(skill_data, dict):
        raise ValueError("能力导入包缺少 skill 对象")
    name = str(skill_data.get("name") or "").strip()
    if not name:
        raise ValueError("能力导入包缺少 skill.name")
    return skill_data


def _tool_health(session: Session, tool_ids: list[str], org_id: str) -> tuple[list[str], list[str]]:
    ids = list(dict.fromkeys(tool_ids))
    if not ids:
        return [], []
    rows = session.exec(
        select(ToolDefinition).where(
            ToolDefinition.id.in_(ids),
            visible_tool_filter(org_id),
        )
    ).all()
    tool_map = {row.id: row for row in rows}
    missing = [tool_id for tool_id in ids if tool_id not in tool_map]
    inactive = [tool_id for tool_id, row in tool_map.items() if row.status != "active"]
    return missing, inactive


def _skill_changes(current: Skill | None, incoming: dict) -> list[SkillChangeRead]:
    if not current:
        return []
    current_values = {
        "display_name": current.display_name,
        "description": current.description,
        "instructions": current.instructions,
        "allowed_tools": _loads(current.allowed_tools_json, []),
        "metadata": _loads(current.metadata_json, {}),
        "status": current.status,
    }
    incoming_values = {
        "display_name": str(incoming.get("display_name") or incoming.get("name") or ""),
        "description": str(incoming.get("description") or ""),
        "instructions": str(incoming.get("instructions") or ""),
        "allowed_tools": incoming.get("allowed_tools") or [],
        "metadata": incoming.get("metadata") or {},
        "status": str(incoming.get("status") or "active"),
    }
    changes: list[SkillChangeRead] = []
    for field, before in current_values.items():
        after = incoming_values[field]
        if before != after:
            changes.append(SkillChangeRead(field=field, before=_preview(before), after=_preview(after)))
    return changes


def _preview(value) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)
    text = text.strip()
    return text[:240] + ("..." if len(text) > 240 else "")


def _yaml_lines(value: dict) -> list[str]:
    lines: list[str] = []
    for key, item in value.items():
        if isinstance(item, dict):
            lines.append(f"{key}:")
            for sub_key, sub_value in item.items():
                lines.append(f"  {sub_key}: {json.dumps(str(sub_value), ensure_ascii=False)}")
        else:
            lines.append(f"{key}: {json.dumps(str(item), ensure_ascii=False)}")
    return lines


def _same_snapshot(skill: Skill, version: SkillVersion) -> bool:
    return (
        skill.name == version.name
        and skill.display_name == version.display_name
        and skill.description == version.description
        and skill.instructions == version.instructions
        and skill.allowed_tools_json == version.allowed_tools_json
        and skill.metadata_json == version.metadata_json
        and skill.status == version.status
        and skill.version == version.version
    )


def _replace_imported_versions(session: Session, skill: Skill, versions: list[dict], actor_role: str) -> None:
    existing = session.exec(
        select(SkillVersion).where(SkillVersion.skill_id == skill.id, SkillVersion.org_id == skill.org_id)
    ).all()
    for item in existing:
        session.delete(item)
    for item in versions:
        if not isinstance(item, dict):
            continue
        validate_allowed_tools(
            session,
            [str(tool_id) for tool_id in item.get("allowed_tools") or [] if tool_id],
            skill.org_id,
            actor_role,
        )
        session.add(
            SkillVersion(
                id=new_id("skillver"),
                org_id=skill.org_id,
                skill_id=skill.id,
                version=int(item.get("version") or 1),
                name=skill.name,
                display_name=str(item.get("display_name") or skill.display_name),
                description=str(item.get("description") or ""),
                instructions=str(item.get("instructions") or ""),
                allowed_tools_json=_dumps(item.get("allowed_tools") or []),
                metadata_json=_dumps(item.get("metadata") or {}),
                status=str(item.get("status") or "active"),
                created_at=str(item.get("created_at") or now_iso()),
            )
        )
    session.commit()
