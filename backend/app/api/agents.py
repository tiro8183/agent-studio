import json
from typing import Dict, List, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.api.deps import AuthContext, get_current_context, require_role
from app.core.models import Agent, AgentReleaseSnapshot, LLMConfig, Skill, ToolDefinition, new_id, now_iso
from app.core.schemas import (
    AgentCompletenessRead,
    AgentCreate,
    AgentPreflightRead,
    AgentRegressionCoverageRead,
    AgentRead,
    AgentReleaseSnapshotRead,
    AgentRuntimeManifestEnvelopeRead,
    AgentRuntimeManifestRead,
    AgentRuntimeManifestPreviewRequest,
    AgentUpdate,
)
from app.db.session import get_session
from app.services.agent_lifecycle_service import (
    AgentLifecycleError,
    deactivate_agent as deactivate_agent_service,
    delete_agent_resources,
    enable_agent_release,
    publish_agent_release,
)
from app.services.agent_execution_service import AgentExecutionService
from app.services.openai_compatible_service import ResponsesRequest, responses_to_execution, stream_responses_events
from app.services.agent_preflight_service import build_agent_preflight, preflight_to_completeness
from app.services.agent_slug_service import ensure_unique_agent_slug, unique_slug_for_agent
from app.services.llm_provider_policy import validate_model_binding
from app.services.mappers import _dumps, _loads, agent_from_create, agent_to_read
from app.services.regression_coverage_service import build_regression_coverage
from app.services.runtime_manifest_service import build_runtime_manifest, build_runtime_manifest_envelope
from app.services.runtime_plan_service import build_preview_runtime_plan, build_release_runtime_plan
from app.services.runtime_snapshot_service import latest_release_snapshot
from app.services.tenant_scope import get_agent_or_404, get_llm_or_404, visible_tool_filter
from app.services.tool_registry import validate_tool_bindings

router = APIRouter(prefix="/agents", tags=["agents"])


def _agent_to_read(agent: Agent, session: Session) -> AgentRead:
    current_hash = build_preview_runtime_plan(agent, session).spec_hash
    latest_release = latest_release_snapshot(session, agent.id, agent.org_id)
    release_hash = latest_release.spec_hash if latest_release else ""
    return agent_to_read(
        agent,
        current_spec_hash=current_hash,
        latest_release_spec_hash=release_hash,
        config_pending_publish=bool(release_hash and current_hash != release_hash),
    )


@router.get("", response_model=List[AgentRead])
def list_agents(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[AgentRead]:
    agents = session.exec(
        select(Agent)
        .where(Agent.org_id == context.organization.id)
        .order_by(Agent.created_at.desc())
    ).all()
    return [_agent_to_read(agent, session) for agent in agents]


@router.get("/{agent_id}", response_model=AgentRead)
def get_agent(
    agent_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AgentRead:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    return _agent_to_read(agent, session)


def _completeness(agent: Agent, session: Session) -> AgentCompletenessRead:
    return preflight_to_completeness(build_agent_preflight(agent, session))


@router.get("/{agent_id}/completeness", response_model=AgentCompletenessRead)
def get_agent_completeness(
    agent_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AgentCompletenessRead:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    return _completeness(agent, session)


@router.get("/{agent_id}/preflight", response_model=AgentPreflightRead)
def get_agent_preflight(
    agent_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AgentPreflightRead:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    return build_agent_preflight(agent, session)


@router.post("/{agent_id}/preflight", response_model=AgentPreflightRead)
def run_agent_preflight(
    agent_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AgentPreflightRead:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    return build_agent_preflight(agent, session)


@router.get("/{agent_id}/regression-coverage", response_model=AgentRegressionCoverageRead)
def get_agent_regression_coverage(
    agent_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AgentRegressionCoverageRead:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    return build_regression_coverage(agent, session)


@router.get("/{agent_id}/runtime-manifest", response_model=AgentRuntimeManifestEnvelopeRead)
def get_agent_runtime_manifest(
    agent_id: str,
    source: Literal["draft", "release"] = "draft",
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AgentRuntimeManifestEnvelopeRead:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    if source == "release":
        release = latest_release_snapshot(session, agent.id, context.organization.id)
        if not release:
            raise HTTPException(status_code=404, detail="上线版本不存在")
        release_plan = build_release_runtime_plan(agent, release)
        return build_runtime_manifest_envelope(
            source="release",
            manifest=release_plan.runtime_manifest,
            release_id=release.id,
            manifest_hash=release_plan.manifest_hash,
        )
    manifest = build_runtime_manifest(agent, session)
    return build_runtime_manifest_envelope(source="draft", manifest=manifest)


@router.post("/{agent_id}/runtime-manifest/preview", response_model=AgentRuntimeManifestEnvelopeRead)
def preview_agent_runtime_manifest(
    agent_id: str,
    payload: AgentRuntimeManifestPreviewRequest,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AgentRuntimeManifestEnvelopeRead:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    preview_agent = _agent_preview_from_update(agent, payload)
    _validate_agent_resources(payload, session, context.organization.id, context.membership.role, current_agent=agent)
    manifest = build_runtime_manifest(preview_agent, session)
    return build_runtime_manifest_envelope(source="preview", manifest=manifest)


@router.post("/{agent_id}/preview-responses")
async def preview_agent_response(
    agent_id: str,
    payload: ResponsesRequest,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
):
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    if not payload.stream:
        raise HTTPException(status_code=400, detail="预览执行仅支持流式响应")
    service = AgentExecutionService(
        session,
        org_id=context.organization.id,
        actor_role=context.membership.role,
        actor_user_id=context.user.id,
    )
    request = responses_to_execution(
        session,
        context.organization.id,
        payload.model_copy(update={"model": f"agent:{agent.slug or agent.id}", "stream": True}),
    ).model_copy(update={
        "preview": True,
        "entrypoint": "preview_responses",
        "run_source": "studio_preview",
    })
    return StreamingResponse(
        stream_responses_events(service, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _release_to_read(release: AgentReleaseSnapshot) -> AgentReleaseSnapshotRead:
    try:
        agent_spec = json.loads(release.agent_spec_json or "{}")
    except (json.JSONDecodeError, TypeError):
        agent_spec = {}
    try:
        runtime_spec = json.loads(release.runtime_spec_json or "{}")
    except (json.JSONDecodeError, TypeError):
        runtime_spec = {}
    agent = Agent(
        id=str(agent_spec.get("id") or release.agent_id),
        org_id=release.org_id,
        name=str(agent_spec.get("name") or ""),
        llm_config_id=str(agent_spec.get("llm_config_id") or ""),
        model=str(agent_spec.get("model") or ""),
    )
    release_plan = build_release_runtime_plan(agent, release)
    knowledge_items = list(runtime_spec.get("knowledge") or [])
    return AgentReleaseSnapshotRead(
        id=release.id,
        org_id=release.org_id,
        agent_id=release.agent_id,
        version=release.version,
        status=release.status,
        spec_hash=release.spec_hash,
        manifest_hash=release_plan.manifest_hash,
        agent_spec=agent_spec,
        knowledge_snapshot_count=len(knowledge_items),
        knowledge_snapshot_bytes=sum(int(item.get("snapshot_size") or 0) for item in knowledge_items),
        runtime_manifest=release_plan.runtime_manifest,
        created_at=release.created_at,
    )


def _agent_preview_from_update(agent: Agent, payload: AgentUpdate) -> Agent:
    preview = Agent(
        id=agent.id,
        org_id=agent.org_id,
        name=agent.name,
        slug=agent.slug,
        description=agent.description,
        system_prompt=agent.system_prompt,
        llm_config_id=agent.llm_config_id,
        model=agent.model,
        engine_mode=agent.engine_mode,
        tools_json=agent.tools_json,
        skills_json=agent.skills_json,
        subagents_json=agent.subagents_json,
        memory_json=agent.memory_json,
        filesystem_json=agent.filesystem_json,
        permissions_json=agent.permissions_json,
        runtime_json=agent.runtime_json,
        output_json=agent.output_json,
        harness_json=agent.harness_json,
        metadata_json=agent.metadata_json,
        model_override_json=agent.model_override_json,
        routing_json=agent.routing_json,
        context_config_json=agent.context_config_json,
        max_iterations=agent.max_iterations,
        status=agent.status,
        version=agent.version,
        published_at=agent.published_at,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )
    updates = payload.model_dump(exclude_unset=True)
    for field_name, json_name in (
        ("tools", "tools_json"),
        ("skills", "skills_json"),
        ("subagents", "subagents_json"),
        ("memory", "memory_json"),
        ("filesystem", "filesystem_json"),
        ("permissions", "permissions_json"),
        ("runtime", "runtime_json"),
        ("output", "output_json"),
        ("harness", "harness_json"),
        ("metadata", "metadata_json"),
        ("model_override", "model_override_json"),
        ("routing", "routing_json"),
        ("context_config", "context_config_json"),
    ):
        if field_name in updates:
            setattr(preview, json_name, _dumps(getattr(payload, field_name)))
            updates.pop(field_name)
    for key, value in updates.items():
        if value is not None:
            setattr(preview, key, value)
    return preview


def _validate_agent_resources(
    payload: AgentCreate | AgentUpdate,
    session: Session,
    org_id: str,
    actor_role: str,
    *,
    current_agent: Agent | None = None,
) -> None:
    llm_config_id = _next_payload_value(payload, "llm_config_id", current_agent)
    model = _next_payload_value(payload, "model", current_agent)
    if not llm_config_id:
        raise HTTPException(status_code=400, detail="必须绑定模型通道")
    llm = get_llm_or_404(session, llm_config_id, org_id)
    _ensure_model_bindable(llm, model, "主模型")
    if _field_supplied(payload, "tools"):
        _ensure_agent_tools_configurable(session, getattr(payload, "tools", None) or [], org_id, actor_role, "主服务")
    if _field_supplied(payload, "skills"):
        _ensure_skills_visible(session, getattr(payload, "skills", None) or [], org_id)
    subagents = (
        getattr(payload, "subagents", None)
        if _field_supplied(payload, "subagents")
        else _loads(current_agent.subagents_json, []) if current_agent else []
    )
    for subagent in subagents or []:
        subagent_llm_id = _subagent_value(subagent, "llm_config_id") or llm_config_id
        subagent_model = _subagent_value(subagent, "model") or model
        subagent_name = _subagent_value(subagent, "name") or "协作角色"
        if subagent_llm_id:
            subagent_llm = get_llm_or_404(session, subagent_llm_id, org_id)
            _ensure_model_bindable(subagent_llm, subagent_model, f"协作角色 {subagent_name} 的模型")
        if _field_supplied(payload, "subagents"):
            _ensure_agent_tools_configurable(
                session,
                _subagent_value(subagent, "tools") or [],
                org_id,
                actor_role,
                f"协作角色 {subagent_name}",
            )
            _ensure_skills_visible(session, _subagent_value(subagent, "skills") or [], org_id)


def _field_supplied(payload: AgentCreate | AgentUpdate, field_name: str) -> bool:
    if isinstance(payload, AgentCreate):
        return True
    return field_name in payload.model_fields_set


def _next_payload_value(payload: AgentCreate | AgentUpdate, field_name: str, current_agent: Agent | None) -> str | None:
    if _field_supplied(payload, field_name):
        return getattr(payload, field_name, None)
    return getattr(current_agent, field_name, None) if current_agent else None


def _subagent_value(subagent, field_name: str):
    if isinstance(subagent, dict):
        return subagent.get(field_name)
    return getattr(subagent, field_name, None)


def _ensure_model_bindable(llm: LLMConfig, model: str | None, label: str) -> None:
    available_models = _loads(llm.available_models_json, [])
    try:
        validate_model_binding(model, available_models, label=label)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _ensure_tools_visible(session: Session, tool_ids: list[str], org_id: str) -> None:
    ids = sorted({tool_id for tool_id in tool_ids if tool_id})
    if not ids:
        return
    rows = session.exec(select(ToolDefinition).where(ToolDefinition.id.in_(ids), visible_tool_filter(org_id))).all()
    found = {row.id for row in rows}
    missing = [tool_id for tool_id in ids if tool_id not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"工具不存在或不可见: {', '.join(missing)}")


def _ensure_agent_tools_configurable(
    session: Session,
    tool_ids: list[str],
    org_id: str,
    actor_role: str,
    label: str,
) -> None:
    try:
        validate_tool_bindings(session, tool_ids, org_id, actor_role, label=label)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _ensure_skills_visible(session: Session, skill_ids: list[str], org_id: str) -> None:
    ids = sorted({skill_id for skill_id in skill_ids if skill_id})
    if not ids:
        return
    rows = session.exec(select(Skill).where(Skill.id.in_(ids), Skill.org_id == org_id)).all()
    found = {row.id for row in rows}
    missing = [skill_id for skill_id in ids if skill_id not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"能力包不存在或不可见: {', '.join(missing)}")


@router.get("/{agent_id}/releases", response_model=List[AgentReleaseSnapshotRead])
def list_agent_releases(
    agent_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[AgentReleaseSnapshotRead]:
    get_agent_or_404(session, agent_id, context.organization.id)
    rows = session.exec(
        select(AgentReleaseSnapshot)
        .where(AgentReleaseSnapshot.agent_id == agent_id, AgentReleaseSnapshot.org_id == context.organization.id)
        .order_by(AgentReleaseSnapshot.version.desc())
    ).all()
    return [_release_to_read(row) for row in rows]


@router.get("/{agent_id}/releases/{version}", response_model=AgentReleaseSnapshotRead)
def get_agent_release(
    agent_id: str,
    version: int,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> AgentReleaseSnapshotRead:
    get_agent_or_404(session, agent_id, context.organization.id)
    release = session.exec(
        select(AgentReleaseSnapshot)
        .where(
            AgentReleaseSnapshot.agent_id == agent_id,
            AgentReleaseSnapshot.version == version,
            AgentReleaseSnapshot.org_id == context.organization.id,
        )
        .limit(1)
    ).first()
    if not release:
        raise HTTPException(status_code=404, detail="上线版本不存在")
    return _release_to_read(release)


@router.post("", response_model=AgentRead)
def create_agent(
    payload: AgentCreate,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentRead:
    org_id = context.organization.id
    _validate_agent_resources(payload, session, org_id, context.membership.role)
    agent_id = new_id("agent")
    payload.slug = unique_slug_for_agent(session, org_id, agent_id, payload.name, payload.slug or None)
    agent = agent_from_create(agent_id, payload, org_id=org_id)
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return _agent_to_read(agent, session)


@router.post("/{agent_id}/publish", response_model=AgentRead)
def publish_agent(
    agent_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentRead:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    preflight = build_agent_preflight(agent, session)
    try:
        saved = publish_agent_release(session, agent, preflight)
    except AgentLifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _agent_to_read(saved, session)


@router.post("/{agent_id}/deactivate", response_model=AgentRead)
def deactivate_agent(
    agent_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentRead:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    try:
        saved = deactivate_agent_service(session, agent)
    except AgentLifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _agent_to_read(saved, session)


@router.post("/{agent_id}/enable-release", response_model=AgentRead)
def enable_agent_release_route(
    agent_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentRead:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    preflight = build_agent_preflight(agent, session)
    try:
        saved = enable_agent_release(session, agent, preflight)
    except AgentLifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _agent_to_read(saved, session)


@router.put("/{agent_id}", response_model=AgentRead)
def update_agent(
    agent_id: str,
    payload: AgentUpdate,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentRead:
    org_id = context.organization.id
    agent = get_agent_or_404(session, agent_id, org_id)
    saved = _update_agent_draft(agent, payload, session, org_id, context.membership.role)
    return _agent_to_read(saved, session)


@router.put("/{agent_id}/draft", response_model=AgentRead)
def update_agent_draft(
    agent_id: str,
    payload: AgentUpdate,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> AgentRead:
    org_id = context.organization.id
    agent = get_agent_or_404(session, agent_id, org_id)
    saved = _update_agent_draft(agent, payload, session, org_id, context.membership.role)
    return _agent_to_read(saved, session)


def _update_agent_draft(
    agent: Agent,
    payload: AgentUpdate,
    session: Session,
    org_id: str,
    actor_role: str,
) -> Agent:
    updates = payload.model_dump(exclude_unset=True)
    _validate_agent_resources(payload, session, org_id, actor_role, current_agent=agent)
    if "slug" in updates:
        if payload.slug is None:
            updates.pop("slug")
        else:
            updates["slug"] = ensure_unique_agent_slug(session, org_id, payload.slug, exclude_agent_id=agent.id)
    for field_name, json_name in (
        ("tools", "tools_json"),
        ("skills", "skills_json"),
        ("subagents", "subagents_json"),
        ("memory", "memory_json"),
        ("filesystem", "filesystem_json"),
        ("permissions", "permissions_json"),
        ("runtime", "runtime_json"),
        ("output", "output_json"),
        ("harness", "harness_json"),
        ("metadata", "metadata_json"),
        ("model_override", "model_override_json"),
        ("routing", "routing_json"),
        ("context_config", "context_config_json"),
    ):
        if field_name in updates:
            setattr(agent, json_name, _dumps(getattr(payload, field_name)))
            updates.pop(field_name)
    for key, value in updates.items():
        setattr(agent, key, value)
    agent.updated_at = now_iso()
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


@router.delete("/{agent_id}")
def delete_agent(
    agent_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> Dict[str, str]:
    agent = get_agent_or_404(session, agent_id, context.organization.id)
    delete_agent_resources(session, agent)
    return {"status": "deleted"}
