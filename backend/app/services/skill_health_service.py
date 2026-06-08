from sqlmodel import Session, select

from app.core.models import Skill, SkillVersion, ToolDefinition
from app.core.schemas import SkillHealthCheckRead, SkillHealthRead
from app.services.mappers import _loads
from app.services.skill_service import skill_impact, skill_runtime_preview
from app.services.tenant_scope import visible_tool_filter
from app.services.tool_health_service import build_tool_health


def build_skill_health(skill: Skill, session: Session) -> SkillHealthRead:
    preview = skill_runtime_preview(session, skill)
    impact = skill_impact(session, skill)
    tool_health = _allowed_tool_health(skill, session)
    unhealthy_tools = [item for item in tool_health if not item.ready]
    has_current_snapshot = _has_current_version_snapshot(skill, session)
    checks = [
        SkillHealthCheckRead(
            key="status",
            label="启用状态",
            passed=skill.status == "active",
            severity="blocker",
            detail="Skill 必须启用才会进入 Agent Runtime。",
            evidence={"status": skill.status},
        ),
        SkillHealthCheckRead(
            key="instructions",
            label="执行规范",
            passed=bool(skill.instructions.strip()),
            severity="blocker",
            detail="执行规范需要提供清晰可执行的行为指导。",
            evidence={"length": len(skill.instructions.strip())},
        ),
        SkillHealthCheckRead(
            key="allowed_tools",
            label="Skill allowed tools",
            passed=not preview.missing_tools and not preview.inactive_tools,
            severity="blocker",
            detail="Skill allowed tools 可用。" if not preview.missing_tools and not preview.inactive_tools else "存在缺失或未启用的 Tools。",
            evidence={
                "allowed_tools": _loads(skill.allowed_tools_json, []),
                "missing_tools": preview.missing_tools,
                "inactive_tools": preview.inactive_tools,
            },
        ),
        SkillHealthCheckRead(
            key="allowed_tool_health",
            label="Skill allowed tools 上线检查",
            passed=not unhealthy_tools,
            severity="blocker",
            detail="Skill allowed tools 上线检查通过。" if not unhealthy_tools else f"{len(unhealthy_tools)} 个 allowed Tools 存在未通过项。",
            evidence={
                "tools": [
                    {
                        "tool_id": item.tool_id,
                        "ready": item.ready,
                        "score": item.score,
                        "blockers": item.blockers,
                        "warnings": item.warnings,
                    }
                    for item in tool_health
                ],
            },
        ),
        SkillHealthCheckRead(
            key="version_catalog",
            label="版本清单",
            passed=has_current_snapshot,
            severity="warning",
            detail="当前能力内容已有版本清单记录。" if has_current_snapshot else "当前内容尚未进入版本清单。",
            evidence={"version": skill.version},
        ),
        SkillHealthCheckRead(
            key="impact",
            label="影响范围",
            passed=impact.published_agents == 0,
            severity="info",
            detail=f"当前绑定 {impact.total_agents} 个服务，其中 {impact.published_agents} 个已上线。",
            evidence={
                "total_agents": impact.total_agents,
                "published_agents": impact.published_agents,
            },
        ),
    ]
    blockers = sum(1 for item in checks if not item.passed and item.severity == "blocker")
    warnings = sum(1 for item in checks if not item.passed and item.severity == "warning")
    scored = [item for item in checks if item.severity in {"blocker", "warning"}]
    score = round(sum(1 for item in scored if item.passed) / len(scored) * 100)
    return SkillHealthRead(
        skill_id=skill.id,
        name=skill.name,
        display_name=skill.display_name,
        status=skill.status,
        ready=blockers == 0,
        score=score,
        blockers=blockers,
        warnings=warnings,
        bound_agents=impact.total_agents,
        published_agents=impact.published_agents,
        checks=checks,
    )


def build_skills_health(skills: list[Skill], session: Session) -> list[SkillHealthRead]:
    return [build_skill_health(skill, session) for skill in skills]


def _allowed_tool_health(skill: Skill, session: Session):
    tool_ids = list(dict.fromkeys(item for item in _loads(skill.allowed_tools_json, []) if item))
    if not tool_ids:
        return []
    rows = session.exec(
        select(ToolDefinition).where(
            ToolDefinition.id.in_(tool_ids),
            visible_tool_filter(skill.org_id),
        )
    ).all()
    tool_map = {row.id: row for row in rows}
    return [
        build_tool_health(tool_map[tool_id], session, org_id=skill.org_id)
        for tool_id in tool_ids
        if tool_id in tool_map
    ]


def _has_current_version_snapshot(skill: Skill, session: Session) -> bool:
    return session.exec(
        select(SkillVersion)
        .where(
            SkillVersion.skill_id == skill.id,
            SkillVersion.org_id == skill.org_id,
            SkillVersion.version == skill.version,
            SkillVersion.name == skill.name,
            SkillVersion.display_name == skill.display_name,
            SkillVersion.description == skill.description,
            SkillVersion.instructions == skill.instructions,
            SkillVersion.allowed_tools_json == skill.allowed_tools_json,
            SkillVersion.metadata_json == skill.metadata_json,
            SkillVersion.status == skill.status,
        )
        .limit(1)
    ).first() is not None
