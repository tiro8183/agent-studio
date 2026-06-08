from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Iterable

from sqlalchemy import func, or_
from sqlmodel import Session, select

from app.core.models import (
    Agent,
    AgentRun,
    LLMConfig,
    Skill,
    ToolDefinition,
    ToolInvocationAudit,
    now_iso,
)
from app.core.schemas import (
    AgentStudioWorkspaceRead,
    AssetGovernanceItemRead,
    AssetGovernanceRead,
    CommandCenterRead,
    OperationsWorkspaceRead,
    RunEvidenceWorkspaceRead,
    RuntimeResourceRead,
    RuntimeSummaryRead,
    WorkspaceActionRead,
    WorkspaceAgentSummaryRead,
    WorkspaceIssueRead,
    WorkspaceMetricRead,
)
from app.services.agent_preflight_service import build_agent_preflight
from app.services.mappers import _loads, agent_to_read
from app.services.run_read_service import agent_run_to_read
from app.services.runtime_manifest_hash import hash_runtime_manifest
from app.services.runtime_manifest_service import build_runtime_manifest
from app.services.runtime_plan_service import build_preview_runtime_plan
from app.services.runtime_snapshot_service import latest_release_snapshot
from app.services.skill_health_service import build_skill_health
from app.services.skill_service import skill_runtime_preview
from app.services.tool_health_service import build_tool_health


def command_center_view(session: Session, org_id: str, organization_name: str) -> CommandCenterRead:
    agents = _agents(session, org_id)
    runs = _recent_runs(session, org_id, limit=8)
    incidents = _incident_runs(session, org_id, limit=6)
    published = [agent for agent in agents if agent.status == "published"]
    unpublished = [agent for agent in agents if agent.status == "unpublished"]
    inactive = [agent for agent in agents if agent.status == "inactive"]
    pending = _pending_publish_agents(session, agents)
    status_tone = "blocked" if incidents else "warning" if pending or unpublished else "ready"
    next_action = (
        "处理 Run Evidence 中的高优先级异常"
        if incidents
        else "发布配置变更"
        if pending
        else "推进未上线 Agent"
        if unpublished
        else "验证新的业务任务"
    )
    return CommandCenterRead(
        organization_name=organization_name,
        status_tone=status_tone,
        next_action=next_action,
        generated_at=now_iso(),
        metrics=[
            _metric("agents", "Agent 总数", len(agents), f"{len(published)} 已上线 / {len(unpublished)} 未上线", "ready" if agents else "muted"),
            _metric("pending", "变更待发布", len(pending), "配置变更待发布", "warning" if pending else "ready"),
            _metric("runs", "运行证据", _count_runs(session, org_id), "统一运行证据", "ready"),
            _metric("incidents", "运行异常", len(incidents), "近 24 小时异常", "blocked" if incidents else "ready"),
            _metric("inactive", "停用 Agent", len(inactive), "停用 Agent", "muted"),
        ],
        actions=[
            WorkspaceActionRead(key="directory", label="打开服务目录", target="/services"),
            WorkspaceActionRead(key="experience", label="体验验证", target="/experience", disabled=not published, reason="需要已上线 Agent"),
            WorkspaceActionRead(key="studio", label="打开 Agent Studio", target="/agents"),
        ],
        priority_agents=[_agent_summary(session, agent) for agent in _priority_agents(session, agents)[:6]],
        issues=_run_issues(incidents),
    )


def agent_studio_workspace_view(session: Session, org_id: str) -> AgentStudioWorkspaceRead:
    agents = _agents(session, org_id)
    summaries = [_agent_summary(session, agent, include_runtime=True) for agent in agents]
    blockers = sum(item.blockers for item in summaries)
    warnings = sum(item.warnings for item in summaries)
    pending = sum(1 for item in summaries if item.config_pending_publish)
    return AgentStudioWorkspaceRead(
        generated_at=now_iso(),
        agents=summaries,
        metrics=[
            _metric("agents", "Agent 总数", len(agents), "服务配置对象", "ready" if agents else "muted"),
            _metric("blockers", "未通过项", blockers, "上线检查未通过", "blocked" if blockers else "ready"),
            _metric("warnings", "风险提示", warnings, "上线检查风险提示", "warning" if warnings else "ready"),
            _metric("pending_release", "变更待发布", pending, "配置变更待发布", "warning" if pending else "ready"),
        ],
        issues=[
            WorkspaceIssueRead(
                key=f"agent:{item.id}",
                label=f"{item.name} 需要处理",
                detail=item.next_action,
                severity="critical" if item.blockers else "warning",
                target="/agents",
                resource_id=item.id,
            )
            for item in summaries
            if item.blockers or item.warnings or item.config_pending_publish
        ][:12],
    )


def asset_governance_view(session: Session, org_id: str) -> AssetGovernanceRead:
    providers = _providers(session, org_id)
    tools = _tools(session, org_id)
    skills = _skills(session, org_id)
    agents = _agents(session, org_id)
    provider_items = [_provider_item(provider, agents) for provider in providers]
    tool_items = [_tool_item(session, org_id, tool, agents, skills) for tool in tools]
    skill_items = [_skill_item(session, skill, agents) for skill in skills]
    issues = [
        _asset_issue(item)
        for item in [*provider_items, *tool_items, *skill_items]
        if item.blockers or item.warnings
    ]
    return AssetGovernanceRead(
        generated_at=now_iso(),
        metrics=[
            _metric("providers", "模型通道", len(providers), f"{sum(1 for item in providers if item.status == 'active')} 启用", "ready" if providers else "muted"),
            _metric("tools", "Tools", len(tools), f"{sum(1 for item in tools if item.status == 'active')} 启用", "ready" if tools else "muted"),
            _metric("skills", "Skills", len(skills), f"{sum(1 for item in skills if item.status == 'active')} 启用", "ready" if skills else "muted"),
            _metric("issues", "治理事项", len(issues), "未通过项和风险提示", "blocked" if any(item.severity == "critical" for item in issues) else "warning" if issues else "ready"),
        ],
        providers=provider_items,
        tools=tool_items,
        skills=skill_items,
        issues=issues[:16],
    )


def run_evidence_workspace_view(session: Session, org_id: str, limit: int = 30) -> RunEvidenceWorkspaceRead:
    runs = _recent_runs(session, org_id, limit=min(max(limit, 1), 100))
    incidents = _incident_runs(session, org_id, limit=8)
    completed = _count_runs(session, org_id, status="completed")
    failed = _count_runs(session, org_id, status="failed")
    running = _count_runs(session, org_id, status="running")
    return RunEvidenceWorkspaceRead(
        generated_at=now_iso(),
        metrics=[
            _metric("runs", "运行证据", _count_runs(session, org_id), "全部运行记录", "ready"),
            _metric("completed", "成功运行", completed, "成功运行", "ready"),
            _metric("failed", "失败运行", failed, "失败运行", "blocked" if failed else "ready"),
            _metric("running", "进行中", running, "进行中", "warning" if running else "muted"),
        ],
        runs=[_run_to_read(session, run) for run in runs],
        issues=_run_issues(incidents),
    )


def operations_workspace_view(session: Session, org_id: str) -> OperationsWorkspaceRead:
    incidents = _incident_runs(session, org_id, limit=8)
    providers = _providers(session, org_id)
    missing_keys = [item for item in providers if item.status == "active" and not item.api_key]
    failed_providers = [item for item in providers if item.last_check_status == "failed"]
    status_tone = "blocked" if incidents or missing_keys or failed_providers else "ready"
    next_action = (
        "处理运行异常和模型接入问题"
        if status_tone == "blocked"
        else "平台运行状态正常，继续观察容量和证据留存"
    )
    return OperationsWorkspaceRead(
        generated_at=now_iso(),
        status_tone=status_tone,
        next_action=next_action,
        metrics=[
            _metric("incidents", "运行异常", len(incidents), "近 24 小时运行异常", "blocked" if incidents else "ready"),
            _metric("providers_failed", "通道异常", len(failed_providers), "模型通道连通异常", "blocked" if failed_providers else "ready"),
            _metric("missing_keys", "缺少密钥", len(missing_keys), "启用的模型通道缺少密钥", "blocked" if missing_keys else "ready"),
            _metric("runs", "运行证据", _count_runs(session, org_id), "证据留存总量", "ready"),
        ],
        issues=[
            *_run_issues(incidents),
            *[
                WorkspaceIssueRead(
                    key=f"provider:{item.id}:key",
                    label=f"{item.name} 缺少 API Key",
                    detail="Active Model Provider 没有可用密钥。",
                    severity="critical",
                    target="/providers",
                    resource_id=item.id,
                )
                for item in missing_keys
            ],
            *[
                WorkspaceIssueRead(
                    key=f"provider:{item.id}:health",
                    label=f"{item.name} 连通异常",
                    detail=item.last_check_message or "Model Provider health check failed.",
                    severity="critical",
                    target="/providers",
                    resource_id=item.id,
                )
                for item in failed_providers
            ],
        ][:16],
    )


def runtime_summary_for_agent(session: Session, agent: Agent) -> RuntimeSummaryRead:
    manifest = build_runtime_manifest(agent, session)
    direct_ids = _loads(agent.tools_json, [])
    direct_tools = [item for item in manifest.main_tools if item.id in direct_ids]
    skill_refs = manifest.main_skills
    direct_id_set = {item.id for item in direct_tools}
    skill_allowed_tools = [item for item in manifest.main_tools if item.id not in direct_id_set]
    return RuntimeSummaryRead(
        manifest_hash=hash_runtime_manifest(manifest),
        source="draft",
        direct_tools=direct_tools,
        skill_references=skill_refs,
        skill_allowed_tools=skill_allowed_tools,
        runtime_tools=manifest.main_tools,
        missing_tools=manifest.missing_tools,
        missing_skills=manifest.missing_skills,
        inactive_tools=manifest.inactive_tools,
        inactive_skills=manifest.inactive_skills,
    )


def _agents(session: Session, org_id: str) -> list[Agent]:
    return session.exec(
        select(Agent).where(Agent.org_id == org_id).order_by(Agent.updated_at.desc())
    ).all()


def _providers(session: Session, org_id: str) -> list[LLMConfig]:
    return session.exec(
        select(LLMConfig).where(LLMConfig.org_id == org_id).order_by(LLMConfig.updated_at.desc())
    ).all()


def _tools(session: Session, org_id: str) -> list[ToolDefinition]:
    return session.exec(
        select(ToolDefinition)
        .where((ToolDefinition.org_id == org_id) | (ToolDefinition.implementation == "builtin"))
        .order_by(ToolDefinition.category, ToolDefinition.name)
    ).all()


def _skills(session: Session, org_id: str) -> list[Skill]:
    return session.exec(
        select(Skill).where(Skill.org_id == org_id).order_by(Skill.updated_at.desc())
    ).all()


def _metric(key: str, label: str, value: int | str, detail: str, status_tone: str) -> WorkspaceMetricRead:
    return WorkspaceMetricRead(key=key, label=label, value=str(value), detail=detail, status_tone=status_tone)


def _agent_summary(session: Session, agent: Agent, include_runtime: bool = False) -> WorkspaceAgentSummaryRead:
    current_hash = build_preview_runtime_plan(agent, session).spec_hash
    release = latest_release_snapshot(session, agent.id, agent.org_id)
    release_hash = release.spec_hash if release else ""
    pending = bool(release_hash and current_hash != release_hash)
    preflight = build_agent_preflight(agent, session)
    catalog = _service_catalog(agent)
    catalog_gaps = _service_catalog_gaps(catalog)
    contract_model = f"agent:{agent.slug or agent.id}"
    status_tone = "ready" if agent.status == "published" and not pending else "warning" if agent.status != "inactive" else "muted"
    next_action = (
        "处理上线检查未通过项"
        if preflight.blockers
        else "发布配置变更"
        if pending
        else "补齐发布验收"
        if not preflight.can_publish
        else "生成上线版本"
        if agent.status != "published"
        else "保持运行观察"
    )
    return WorkspaceAgentSummaryRead(
        id=agent.id,
        name=agent.name,
        slug=agent.slug,
        description=agent.description,
        status=agent.status,
        status_tone=status_tone,
        model=agent.model,
        version=agent.version,
        config_pending_publish=pending,
        runtime_summary=runtime_summary_for_agent(session, agent) if include_runtime else None,
        next_action=next_action,
        blockers=preflight.blockers,
        warnings=preflight.warnings,
        api_entrypoint="POST /v1/responses",
        contract_model=contract_model,
        integration_policy=catalog.get("integration_policy") or "接入策略待维护",
        approval_status=catalog.get("approval_status") or "待确认",
        support_contact=catalog.get("support_contact") or catalog.get("owner") or "支持联系人待完善",
        data_classification=catalog.get("data_classification") or "数据分级待完善",
        risk_level=catalog.get("risk_level") or ("需复核" if preflight.blockers or preflight.warnings else "常规"),
        catalog_ready=agent.status == "published"
        and not pending
        and not catalog_gaps
        and (catalog.get("approval_status") or "") not in {"待确认", "暂停接入", "禁止接入"},
        catalog_gaps=catalog_gaps,
        updated_at=agent.updated_at,
    )


def _priority_agents(session: Session, agents: list[Agent]) -> list[Agent]:
    def score(agent: Agent) -> tuple[int, str]:
        summary = _agent_summary(session, agent)
        if summary.blockers:
            return (0, agent.updated_at)
        if summary.config_pending_publish:
            return (1, agent.updated_at)
        if agent.status == "unpublished":
            return (2, agent.updated_at)
        if agent.status == "published":
            return (3, agent.updated_at)
        return (4, agent.updated_at)

    return sorted(agents, key=score)


def _pending_publish_agents(session: Session, agents: Iterable[Agent]) -> list[Agent]:
    pending = []
    for agent in agents:
        current_hash = build_preview_runtime_plan(agent, session).spec_hash
        release = latest_release_snapshot(session, agent.id, agent.org_id)
        if release and current_hash != release.spec_hash:
            pending.append(agent)
    return pending


def _recent_runs(session: Session, org_id: str, limit: int) -> list[AgentRun]:
    return session.exec(
        select(AgentRun)
        .where(AgentRun.org_id == org_id)
        .order_by(AgentRun.started_at.desc())
        .limit(limit)
    ).all()


def _incident_runs(session: Session, org_id: str, limit: int) -> list[AgentRun]:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    stale_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=120)).isoformat()
    return session.exec(
        select(AgentRun)
        .where(
            AgentRun.org_id == org_id,
            or_(
                (AgentRun.status.in_(("failed", "stale", "cancelled", "blocked"))) & (AgentRun.started_at >= cutoff),
                (AgentRun.status == "running") & (AgentRun.started_at <= stale_cutoff),
            ),
        )
        .order_by(AgentRun.started_at.desc())
        .limit(limit)
    ).all()


def _count_runs(session: Session, org_id: str, status: str | None = None) -> int:
    stmt = select(func.count()).select_from(AgentRun).where(AgentRun.org_id == org_id)
    if status:
        stmt = stmt.where(AgentRun.status == status)
    return int(session.exec(stmt).one() or 0)


def _run_to_read(session: Session, run: AgentRun):
    return agent_run_to_read(run, session)


def _run_issues(runs: list[AgentRun]) -> list[WorkspaceIssueRead]:
    return [
        WorkspaceIssueRead(
            key=f"run:{run.id}",
            label=f"运行{_run_status_label(run.status)}",
            detail=run.error or run.input_preview or "运行证据需要复核",
            severity="critical" if run.status in {"failed", "blocked", "stale"} else "warning",
            target="/runs",
            resource_id=run.id,
        )
        for run in runs
    ]


def _provider_item(provider: LLMConfig, agents: list[Agent]) -> AssetGovernanceItemRead:
    bound = [agent for agent in agents if agent.llm_config_id == provider.id or any((sub.get("llm_config_id") or agent.llm_config_id) == provider.id for sub in _loads(agent.subagents_json, []))]
    published = [agent for agent in bound if agent.status == "published"]
    blockers = int(provider.status == "active" and not provider.api_key) + int(provider.status == "active" and not provider.default_model) + int(provider.last_check_status == "failed")
    warnings = int(provider.last_check_status == "unchecked") + int(provider.status != "active" and bool(bound))
    return AssetGovernanceItemRead(
        id=provider.id,
        name=provider.name,
        description=f"{provider.provider_type} · {provider.default_model or '默认模型待配置'}",
        kind="model_provider",
        status=provider.status,
        status_tone="blocked" if blockers else "warning" if warnings else "ready",
        blockers=blockers,
        warnings=warnings,
        impact={"bound_agents": len(bound), "published_agents": len(published)},
        next_action="处理模型通道配置未通过项" if blockers else "复核连通检测" if warnings else "保持可用",
        updated_at=provider.updated_at,
    )


def _tool_item(session: Session, org_id: str, tool: ToolDefinition, agents: list[Agent], skills: list[Skill]) -> AssetGovernanceItemRead:
    health = build_tool_health(tool, session)
    direct_agents = [agent for agent in agents if tool.id in _loads(agent.tools_json, [])]
    subagent_agents = [
        agent
        for agent in agents
        if any(tool.id in (sub.get("tools") or []) for sub in _loads(agent.subagents_json, []))
    ]
    skill_refs = [skill for skill in skills if tool.id in _loads(skill.allowed_tools_json, [])]
    failed_audits = int(session.exec(
        select(func.count()).select_from(ToolInvocationAudit).where(
            ToolInvocationAudit.org_id == org_id,
            ToolInvocationAudit.tool_id == tool.id,
            ToolInvocationAudit.status != "success",
        )
    ).one() or 0)
    warnings = health.warnings + int(failed_audits > 0)
    return AssetGovernanceItemRead(
        id=tool.id,
        name=tool.name,
        description=tool.description,
        kind="tool",
        status=tool.status,
        status_tone="blocked" if health.blockers else "warning" if warnings else "ready",
        blockers=health.blockers,
        warnings=warnings,
        impact={
            "direct_agents": len({agent.id for agent in direct_agents}),
            "subagent_agents": len({agent.id for agent in subagent_agents}),
            "skill_allowed_tools": len(skill_refs),
            "published_agents": len({agent.id for agent in [*direct_agents, *subagent_agents] if agent.status == "published"}),
            "failed_audits": failed_audits,
        },
        next_action="处理 Tool 未通过项" if health.blockers else "复核 Tool 运行证据" if warnings else "保持可用",
        updated_at=tool.updated_at,
    )


def _skill_item(session: Session, skill: Skill, agents: list[Agent]) -> AssetGovernanceItemRead:
    health = build_skill_health(skill, session)
    preview = skill_runtime_preview(session, skill)
    main_refs = [agent for agent in agents if skill.id in _loads(agent.skills_json, [])]
    subagent_refs = [
        agent
        for agent in agents
        if any(skill.id in (sub.get("skills") or []) for sub in _loads(agent.subagents_json, []))
    ]
    allowed_lookup = {tool.id: tool for tool in preview.allowed_tools}
    runtime_summary = RuntimeSummaryRead(
        source="draft",
        skill_references=[
            RuntimeResourceRead(
                id=skill.id,
                name=skill.display_name or skill.name,
                status=skill.status,
                kind="skill",
                metadata={"slug": skill.name, "version": skill.version},
            )
        ],
        skill_allowed_tools=[allowed_lookup[item] for item in _loads(skill.allowed_tools_json, []) if item in allowed_lookup],
        runtime_tools=[allowed_lookup[item] for item in _loads(skill.allowed_tools_json, []) if item in allowed_lookup],
        missing_tools=preview.missing_tools,
        inactive_tools=preview.inactive_tools,
    )
    return AssetGovernanceItemRead(
        id=skill.id,
        name=skill.display_name or skill.name,
        description=skill.description,
        kind="skill",
        status=skill.status,
        status_tone="blocked" if health.blockers else "warning" if health.warnings else "ready",
        blockers=health.blockers,
        warnings=health.warnings,
        impact={
            "main_agents": len({agent.id for agent in main_refs}),
            "subagent_agents": len({agent.id for agent in subagent_refs}),
            "published_agents": len({agent.id for agent in [*main_refs, *subagent_refs] if agent.status == "published"}),
            "allowed_tools": len(_loads(skill.allowed_tools_json, [])),
        },
        runtime_summary=runtime_summary,
        next_action="处理 Skill 未通过项" if health.blockers else "复核 Skill allowed tools" if health.warnings else "保持可用",
        updated_at=skill.updated_at,
    )


def _asset_issue(item: AssetGovernanceItemRead) -> WorkspaceIssueRead:
    severity = "critical" if item.blockers else "warning"
    target = "/providers" if item.kind == "model_provider" else f"/{item.kind}s"
    return WorkspaceIssueRead(
        key=f"{item.kind}:{item.id}",
        label=f"{item.name} 需要处理",
        detail=item.next_action,
        severity=severity,
        target=target,
        resource_id=item.id,
    )


def _run_status_label(status: str) -> str:
    labels = {
        "completed": "成功",
        "failed": "失败",
        "running": "进行中",
        "cancelled": "已取消",
        "stale": "超时",
        "blocked": "已阻断",
    }
    return labels.get(status, status or "待确认")


def _service_catalog(agent: Agent) -> dict[str, str]:
    metadata = _loads(agent.metadata_json, {})
    raw = metadata.get("service_catalog") if isinstance(metadata, dict) else {}
    catalog = raw if isinstance(raw, dict) else {}
    return {
        "domain": _text_value(catalog.get("domain")),
        "department": _text_value(catalog.get("department")),
        "owner": _text_value(catalog.get("owner")),
        "service_level": _text_value(catalog.get("service_level")),
        "caller_scope": _text_value(catalog.get("caller_scope")),
        "integration_policy": _text_value(catalog.get("integration_policy")),
        "approval_status": _text_value(catalog.get("approval_status")),
        "support_contact": _text_value(catalog.get("support_contact")),
        "data_classification": _text_value(catalog.get("data_classification")),
        "risk_level": _text_value(catalog.get("risk_level")),
    }


def _service_catalog_gaps(catalog: dict[str, str]) -> list[str]:
    required = [
        ("业务域", catalog.get("domain")),
        ("归属团队", catalog.get("department")),
        ("维护人", catalog.get("owner")),
        ("支持方式", catalog.get("service_level")),
        ("调用范围", catalog.get("caller_scope")),
        ("接入策略", catalog.get("integration_policy")),
        ("数据分级", catalog.get("data_classification")),
    ]
    return [label for label, value in required if not value]


def _text_value(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""
