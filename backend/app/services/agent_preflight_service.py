from sqlmodel import Session, func, select

from app.core.models import Agent, AgentTestRun, AgentTestCase, KnowledgeDocument, LLMConfig, Skill, ToolDefinition, now_iso
from app.core.schemas import (
    AgentCompletenessItem,
    AgentCompletenessRead,
    AgentPreflightCheckRead,
    AgentPreflightRead,
    AgentRegressionCoverageRead,
)
from app.services.llm_provider_policy import available_model_names
from app.services.mappers import _loads, agent_to_read, llm_to_read
from app.services.runtime_capabilities import tool_ids_for_runtime, unique_resource_ids
from app.services.runtime_adapter import RuntimeManifestMismatch, assert_manifest_alignment, compile_runtime_plan
from app.services.runtime_governance_gate import runtime_governance_issues
from app.services.runtime_plan_service import RuntimePlan, build_preview_runtime_plan
from app.services.regression_coverage_service import build_regression_coverage
from app.services.secret_codec import secret_configured
from app.services.skill_health_service import build_skill_health
from app.services.tenant_scope import visible_tool_filter
from app.services.tool_health_service import build_tool_health
from app.services.tool_registry import DEFAULT_TOOL_REQUIRED_ROLE


RUN_REQUIRED_CHECK_KEYS = {
    "identity",
    "deepagents_runtime",
    "runtime_configuration",
    "runtime_manifest_guard",
    "runtime_governance_gate",
    "model_binding",
    "api_key_configured",
    "runtime_resources",
}


def build_agent_preflight(agent: Agent, session: Session) -> AgentPreflightRead:
    agent_read = agent_to_read(agent)
    llm = session.get(LLMConfig, agent.llm_config_id)
    if llm and llm.org_id != agent.org_id:
        llm = None
    llm_read = llm_to_read(llm) if llm else None
    main_model_issues = _main_model_issues(agent, llm)
    subagent_model_issues = _subagent_model_issues(agent, session)
    runtime_plan = build_preview_runtime_plan(agent, session)
    runtime_manifest = runtime_plan.runtime_manifest
    guard_issue = _runtime_guard_issue(runtime_plan)
    governance_issues = runtime_governance_issues(
        manifest=runtime_manifest,
        session=session,
        org_id=agent.org_id,
    )
    knowledge_count = _knowledge_count(session, agent.id, agent.org_id)
    latest_completed_run = _latest_completed_test_run(session, agent.id, agent.org_id, runtime_plan.spec_hash)
    regression_coverage = build_regression_coverage(agent, session)
    tool_health = _bound_tool_health(agent, session)
    unhealthy_tools = [item for item in tool_health if not item.ready]
    skill_health = _bound_skill_health(agent, session)
    unhealthy_skills = [item for item in skill_health if not item.ready]
    resource_errors = [
        *runtime_manifest.missing_tools,
        *runtime_manifest.missing_skills,
        *runtime_manifest.inactive_tools,
        *runtime_manifest.inactive_skills,
    ]
    configured_capabilities = (
        len(agent_read.tools)
        + len(agent_read.skills)
        + len(agent_read.subagents)
    )
    checks = [
        AgentPreflightCheckRead(
            key="identity",
            group="identity",
            label="身份定义",
            passed=bool(agent.name.strip() and agent.description.strip() and agent.system_prompt.strip()),
            severity="blocker",
            detail="名称、描述和系统提示词需要完整。",
            evidence={
                "has_name": bool(agent.name.strip()),
                "has_description": bool(agent.description.strip()),
                "has_system_prompt": bool(agent.system_prompt.strip()),
            },
        ),
        AgentPreflightCheckRead(
            key="deepagents_runtime",
            group="runtime",
            label="DeepAgents 执行引擎",
            passed=agent.engine_mode == "deepagents",
            severity="blocker",
            detail="当前平台主路径只支持 DeepAgents 执行引擎。",
            evidence={
                "engine_mode": agent.engine_mode,
                "backend_type": runtime_manifest.backend_type,
                "checkpointing": runtime_manifest.checkpointing,
            },
        ),
        AgentPreflightCheckRead(
            key="runtime_configuration",
            group="runtime",
            label="Runtime 配置",
            passed=_runtime_configuration_ready(agent),
            severity="blocker",
            detail=_runtime_configuration_detail(agent),
            evidence={
                "filesystem": agent_read.filesystem.model_dump(),
                "permissions": agent_read.permissions.model_dump(),
                "output": agent_read.output.model_dump(),
                "max_iterations": agent.max_iterations,
            },
        ),
        AgentPreflightCheckRead(
            key="runtime_manifest_guard",
            group="runtime",
            label="Runtime Manifest 一致性",
            passed=guard_issue is None,
            severity="blocker",
            detail="Runtime Manifest 与编译计划一致。" if guard_issue is None else "Runtime Manifest 与编译计划不一致，执行会被阻断。",
            evidence={
                "manifest_hash": runtime_plan.manifest_hash,
                "guard_error": guard_issue or "",
            },
        ),
        AgentPreflightCheckRead(
            key="runtime_governance_gate",
            group="runtime",
            label="运行治理门",
            passed=not governance_issues,
            severity="blocker",
            detail="当前治理状态允许运行。" if not governance_issues else "当前治理状态会阻断运行。",
            evidence={
                "model_contracts": [
                    {
                        "scope": contract.scope,
                        "subagent": contract.subagent,
                        "llm_config_id": contract.llm_config_id,
                        "provider_type": contract.provider_type,
                        "model": contract.model,
                        "api_key_ref": contract.api_key_ref,
                    }
                    for contract in runtime_manifest.model_contracts
                ],
                "issues": [
                    {
                        "key": item.key,
                        "resource_type": item.resource_type,
                        "resource_id": item.resource_id,
                        "message": item.message,
                        "evidence": item.evidence,
                    }
                    for item in governance_issues
                ],
            },
        ),
        AgentPreflightCheckRead(
            key="model_binding",
            group="model",
            label="模型绑定",
            passed=bool(
                llm
                and llm.status == "active"
                and agent.model
                and not main_model_issues
                and not subagent_model_issues
            ),
            severity="blocker",
            detail=(
                "需要绑定启用状态的模型通道和模型。"
                if not main_model_issues and not subagent_model_issues
                else "主流程或协作角色存在不可用的模型通道/模型绑定。"
            ),
            evidence={
                "llm_config_id": agent.llm_config_id,
                "llm_status": llm.status if llm else "missing",
                "model": agent.model,
                "api_key_configured": secret_configured(llm.api_key) if llm else False,
                "main_model_issues": main_model_issues,
                "subagent_issues": subagent_model_issues,
            },
        ),
        AgentPreflightCheckRead(
            key="provider_check",
            group="model",
            label="模型通道检测",
            passed=bool(llm and llm.last_check_status == "healthy"),
            severity="warning",
            detail="建议先通过一次模型连通性检测。",
            evidence={
                "last_check_status": llm.last_check_status if llm else "missing",
                "last_check_message": llm.last_check_message if llm else "",
                "last_checked_at": llm.last_checked_at if llm else None,
            },
        ),
        AgentPreflightCheckRead(
            key="api_key_configured",
            group="model",
            label="通道密钥",
            passed=bool(llm_read and llm_read.api_key_configured),
            severity="blocker",
            detail="模型通道必须配置 API Key，避免运行时才暴露凭证缺失。",
            evidence={
                "provider_type": llm.provider_type if llm else "",
                "base_url": llm.base_url if llm else "",
            },
        ),
        AgentPreflightCheckRead(
            key="capabilities",
            group="resources",
            label="Runtime Composition",
            passed=configured_capabilities > 0,
            severity="blocker",
            detail="至少配置 Tool、Skill 或 Subagent 中的一种运行依赖。",
            evidence={
                "tools": len(agent_read.tools),
                "skills": len(agent_read.skills),
                "subagents": len(agent_read.subagents),
            },
        ),
        AgentPreflightCheckRead(
            key="runtime_resources",
            group="resources",
            label="Runtime Resources",
            passed=not resource_errors and not unhealthy_tools and not unhealthy_skills,
            severity="blocker",
            detail="Runtime resources 可用。" if not resource_errors and not unhealthy_tools and not unhealthy_skills else "存在缺失、未启用或上线检查未通过的 Runtime resources。",
            evidence={
                "missing_tools": runtime_manifest.missing_tools,
                "missing_skills": runtime_manifest.missing_skills,
                "inactive_tools": runtime_manifest.inactive_tools,
                "inactive_skills": runtime_manifest.inactive_skills,
                "unhealthy_tools": [
                    {
                        "tool_id": item.tool_id,
                        "required_role": _tool_health_required_role(item),
                        "blockers": item.blockers,
                        "warnings": item.warnings,
                    }
                    for item in unhealthy_tools
                ],
                "unhealthy_skills": [
                    {
                        "skill_id": item.skill_id,
                        "blockers": item.blockers,
                        "warnings": item.warnings,
                    }
                    for item in unhealthy_skills
                ],
            },
        ),
        AgentPreflightCheckRead(
            key="tool_health",
            group="resources",
            label="Tool 上线检查",
            passed=not unhealthy_tools,
            severity="blocker",
            detail="绑定 Tool 上线检查通过。" if not unhealthy_tools else f"{len(unhealthy_tools)} 个绑定 Tool 存在未通过项。",
            evidence={
                "tools": [
                    {
                        "tool_id": item.tool_id,
                        "required_role": _tool_health_required_role(item),
                        "ready": item.ready,
                        "score": item.score,
                        "blockers": item.blockers,
                        "warnings": item.warnings,
                    }
                    for item in tool_health
                ],
            },
        ),
        AgentPreflightCheckRead(
            key="skill_health",
            group="resources",
            label="Skill 上线检查",
            passed=not unhealthy_skills,
            severity="blocker",
            detail="绑定 Skill 上线检查通过。" if not unhealthy_skills else f"{len(unhealthy_skills)} 个绑定 Skill 存在未通过项。",
            evidence={
                "skills": [
                    {
                        "skill_id": item.skill_id,
                        "ready": item.ready,
                        "score": item.score,
                        "blockers": item.blockers,
                        "warnings": item.warnings,
                    }
                    for item in skill_health
                ],
            },
        ),
        AgentPreflightCheckRead(
            key="knowledge",
            group="resources",
            label="业务资料",
            passed=knowledge_count > 0,
            severity="info",
            detail=f"当前已绑定 {knowledge_count} 份业务资料。",
            evidence={"knowledge_count": knowledge_count},
        ),
        AgentPreflightCheckRead(
            key="test_run",
            group="evaluation",
            label="验收运行",
            passed=latest_completed_run is not None,
            severity="blocker",
            detail="需要至少完成一次成功验收运行。",
            evidence={
                "current_runtime_plan_hash": runtime_plan.spec_hash,
                "manifest_hash": runtime_plan.manifest_hash,
                "latest_test_run_id": latest_completed_run.id if latest_completed_run else None,
                "latest_agent_run_id": latest_completed_run.agent_run_id if latest_completed_run else None,
                "latest_completed_run_spec_hash": latest_completed_run.runtime_plan_hash if latest_completed_run else "",
                "latest_completed_run_at": latest_completed_run.started_at if latest_completed_run else None,
            },
        ),
        AgentPreflightCheckRead(
            key="regression_suite",
            group="evaluation",
            label="验收用例",
            passed=regression_coverage.can_publish,
            severity="blocker",
            detail=_regression_coverage_detail(regression_coverage),
            evidence={
                "current_runtime_plan_hash": runtime_plan.spec_hash,
                "manifest_hash": runtime_plan.manifest_hash,
                "total": regression_coverage.total,
                "passed": regression_coverage.passed,
                "failed": regression_coverage.failed,
                "running": regression_coverage.running,
                "untested": regression_coverage.untested,
                "stale": regression_coverage.stale,
                "coverage_percent": regression_coverage.coverage_percent,
                "blockers": regression_coverage.blockers,
                "cases": [item.model_dump() for item in regression_coverage.cases],
            },
        ),
        AgentPreflightCheckRead(
            key="publication_metadata",
            group="operations",
            label="上线元数据",
            passed=agent.status != "published" or bool(agent.published_at),
            severity="warning",
            detail="线上智能体应保留上线时间，便于审计和回滚判断。",
            evidence={
                "status": agent.status,
                "version": agent.version,
                "published_at": agent.published_at,
            },
        ),
    ]
    warnings = sum(1 for item in checks if not item.passed and item.severity == "warning")
    blockers = sum(1 for item in checks if not item.passed and item.severity == "blocker")
    scored_checks = [item for item in checks if item.severity in {"blocker", "warning"}]
    score = round(sum(1 for item in scored_checks if item.passed) / len(scored_checks) * 100)
    publish_required = {*(item.key for item in checks if item.severity == "blocker")}
    can_run = all(item.passed for item in checks if item.key in RUN_REQUIRED_CHECK_KEYS)
    can_publish = all(item.passed for item in checks if item.key in publish_required)
    return AgentPreflightRead(
        agent_id=agent.id,
        agent_name=agent.name,
        runtime_plan_hash=runtime_plan.spec_hash,
        manifest_hash=runtime_plan.manifest_hash,
        status=agent.status,
        score=score,
        can_run=can_run,
        can_publish=can_publish,
        blockers=blockers,
        warnings=warnings,
        checked_at=now_iso(),
        runtime_manifest=runtime_manifest,
        checks=checks,
    )


def preflight_to_completeness(preflight: AgentPreflightRead) -> AgentCompletenessRead:
    return AgentCompletenessRead(
        agent_id=preflight.agent_id,
        score=preflight.score,
        can_publish=preflight.can_publish,
        items=[
            AgentCompletenessItem(
                key=item.key,
                label=item.label,
                passed=item.passed,
                detail=item.detail,
            )
            for item in preflight.checks
            if item.severity == "blocker"
        ],
    )


def _runtime_configuration_ready(agent: Agent) -> bool:
    agent_read = agent_to_read(agent)
    if agent.max_iterations < 1:
        return False
    if agent_read.output.mode == "json_schema" and not agent_read.output.json_schema:
        return False
    if agent_read.permissions.allow_write and not agent_read.permissions.allowed_paths:
        return False
    return True


def _runtime_guard_issue(runtime_plan: RuntimePlan) -> str | None:
    try:
        compiled_plan = compile_runtime_plan(runtime_plan.runtime_manifest)
        assert_manifest_alignment(runtime_plan.runtime_manifest, runtime_plan.manifest_hash, compiled_plan)
    except RuntimeManifestMismatch as exc:
        return str(exc)
    return None


def _runtime_configuration_detail(agent: Agent) -> str:
    agent_read = agent_to_read(agent)
    if agent_read.output.mode == "json_schema" and not agent_read.output.json_schema:
        return "结构化输出已启用，但结构化格式约束为空。"
    if agent_read.permissions.allow_write and not agent_read.permissions.allowed_paths:
        return "允许写入时需要限制访问范围。"
    return "运行时配置可用于 DeepAgents 执行引擎。"


def _knowledge_count(session: Session, agent_id: str, org_id: str) -> int:
    return session.exec(
        select(func.count())
        .select_from(KnowledgeDocument)
        .where(KnowledgeDocument.agent_id == agent_id, KnowledgeDocument.org_id == org_id)
    ).one()


def _main_model_issues(agent: Agent, llm: LLMConfig | None) -> list[dict[str, str]]:
    if not llm:
        return [{"llm_config_id": agent.llm_config_id, "reason": "missing_llm"}]
    if llm.status != "active":
        return [{"llm_config_id": llm.id, "reason": "inactive_llm"}]
    if not agent.model:
        return [{"llm_config_id": llm.id, "reason": "missing_model"}]
    model_names = available_model_names(_loads(llm.available_models_json, []))
    if model_names and agent.model not in model_names:
        return [{"llm_config_id": llm.id, "model": agent.model, "reason": "model_not_available"}]
    return []


def _subagent_model_issues(agent: Agent, session: Session) -> list[dict[str, str]]:
    agent_read = agent_to_read(agent)
    issues: list[dict[str, str]] = []
    for subagent in agent_read.subagents:
        llm_config_id = subagent.llm_config_id or agent.llm_config_id
        model = subagent.model or agent.model
        name = subagent.name or "unnamed"
        llm = session.get(LLMConfig, llm_config_id) if llm_config_id else None
        if llm and llm.org_id != agent.org_id:
            llm = None
        if not llm:
            issues.append({"subagent": name, "llm_config_id": str(llm_config_id or ""), "reason": "missing_llm"})
            continue
        if llm.status != "active":
            issues.append({"subagent": name, "llm_config_id": llm.id, "reason": "inactive_llm"})
            continue
        if not model:
            issues.append({"subagent": name, "llm_config_id": llm.id, "reason": "missing_model"})
            continue
        model_names = available_model_names(_loads(llm.available_models_json, []))
        if model_names and model not in model_names:
            issues.append({"subagent": name, "llm_config_id": llm.id, "model": model, "reason": "model_not_available"})
    return issues


def _latest_completed_test_run(session: Session, agent_id: str, org_id: str, spec_hash: str) -> AgentTestRun | None:
    return session.exec(
        select(AgentTestRun)
        .join(AgentTestCase, AgentTestCase.id == AgentTestRun.case_id)
        .where(
            AgentTestRun.agent_id == agent_id,
            AgentTestRun.org_id == org_id,
            AgentTestRun.status == "passed",
            AgentTestRun.runtime_plan_hash == spec_hash,
            AgentTestRun.agent_run_id.is_not(None),
            AgentTestCase.org_id == org_id,
            AgentTestCase.agent_id == agent_id,
            AgentTestCase.status == "active",
        )
        .order_by(AgentTestRun.started_at.desc())
        .limit(1)
    ).first()


def _regression_coverage_detail(coverage: AgentRegressionCoverageRead) -> str:
    parts = [f"当前通过 {coverage.passed}/{coverage.total} 个纳入验收的用例"]
    if coverage.failed:
        parts.append(f"{coverage.failed} 个失败")
    if coverage.running:
        parts.append(f"{coverage.running} 个运行中")
    if coverage.stale:
        parts.append(f"{coverage.stale} 个结果已过期")
    if coverage.untested:
        parts.append(f"{coverage.untested} 个未运行")
    return "，".join(parts) + "。"


def _bound_tool_health(agent: Agent, session: Session):
    agent_read = agent_to_read(agent)
    skill_allowed_tools = _bound_skill_allowed_tools(agent_read, session)
    tool_ids = tool_ids_for_runtime(agent_read.tools, agent_read.skills, skill_allowed_tools)
    for subagent in agent_read.subagents:
        tool_ids.extend(tool_ids_for_runtime(subagent.tools, subagent.skills, skill_allowed_tools))
    ids = unique_resource_ids(tool_ids)
    if not ids:
        return []
    rows = session.exec(
        select(ToolDefinition).where(
            ToolDefinition.id.in_(ids),
            visible_tool_filter(agent.org_id),
        )
    ).all()
    row_map = {row.id: row for row in rows}
    return [
        build_tool_health(row_map[tool_id], session, org_id=agent.org_id)
        for tool_id in ids
        if tool_id in row_map
    ]


def _bound_skill_health(agent: Agent, session: Session):
    agent_read = agent_to_read(agent)
    skill_ids = list(agent_read.skills)
    for subagent in agent_read.subagents:
        skill_ids.extend(subagent.skills)
    ids = list(dict.fromkeys(skill_id for skill_id in skill_ids if skill_id))
    if not ids:
        return []
    rows = session.exec(select(Skill).where(Skill.id.in_(ids), Skill.org_id == agent.org_id)).all()
    row_map = {row.id: row for row in rows}
    return [
        build_skill_health(row_map[skill_id], session)
        for skill_id in ids
        if skill_id in row_map
    ]


def _bound_skill_allowed_tools(agent_read, session: Session) -> dict[str, list[str]]:
    skill_ids = list(agent_read.skills)
    for subagent in agent_read.subagents:
        skill_ids.extend(subagent.skills)
    ids = unique_resource_ids(skill_ids)
    if not ids:
        return {}
    rows = session.exec(select(Skill).where(Skill.id.in_(ids), Skill.org_id == agent_read.org_id, Skill.status == "active")).all()
    return {
        row.id: [
            str(tool_id)
            for tool_id in _loads(row.allowed_tools_json, [])
            if tool_id
        ]
        for row in rows
    }


def _tool_health_required_role(tool_health) -> str:
    for check in tool_health.checks:
        if check.key == "access_policy":
            role = str(check.evidence.get("required_role") or DEFAULT_TOOL_REQUIRED_ROLE)
            return role
    return DEFAULT_TOOL_REQUIRED_ROLE
