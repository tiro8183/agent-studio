from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import AuthContext, get_current_context, require_role
from app.core.models import ToolDefinition, ToolSecret, now_iso
from app.core.schemas import (
    MCPDiscoveryRead,
    MCPImportRead,
    MCPImportRequest,
    MCPServerRequest,
    OpenAPIImportRead,
    OpenAPIImportRequest,
    ToolCreate,
    ToolHealthRead,
    ToolInvocationAuditRead,
    ToolInvokeRead,
    ToolInvokeRequest,
    ToolRead,
    ToolSecretCreate,
    ToolSecretRead,
    ToolSecretUpdate,
    ToolUpdate,
)
from app.db.session import get_session
from app.services.mcp_importer import discover_mcp_tools, import_mcp_tools
from app.services.openapi_importer import import_openapi_tools
from app.services.secret_codec import encrypt_secret
from app.services.tool_health_service import build_tool_health, build_tools_health
from app.services.tool_governance import tool_deletion_usage, tool_deletion_usage_detail, tool_secret_usage
from app.services.tool_registry import (
    create_tool_definition,
    invoke_tool,
    list_tool_audits,
    list_tool_secrets,
    list_tools,
    secret_to_read,
    tool_to_read,
    update_tool_definition,
)
from app.services.tenant_scope import get_secret_or_404, get_tool_or_404, visible_tool_filter

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("", response_model=list[ToolRead])
def tools(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> list[ToolRead]:
    return list_tools(session, context.organization.id)


@router.get("/health", response_model=list[ToolHealthRead])
def tools_health(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> list[ToolHealthRead]:
    rows = session.exec(
        select(ToolDefinition)
        .where(visible_tool_filter(context.organization.id))
        .order_by(ToolDefinition.category, ToolDefinition.name)
    ).all()
    return build_tools_health(rows, session, org_id=context.organization.id)


@router.get("/{tool_id}/health", response_model=ToolHealthRead)
def tool_health(
    tool_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> ToolHealthRead:
    tool_def = get_tool_or_404(session, tool_id, context.organization.id)
    return build_tool_health(tool_def, session, org_id=context.organization.id)


@router.get("/secrets", response_model=list[ToolSecretRead])
def tool_secrets(
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> list[ToolSecretRead]:
    return list_tool_secrets(session, context.organization.id)


@router.post("/secrets", response_model=ToolSecretRead)
def create_secret(
    payload: ToolSecretCreate,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> ToolSecretRead:
    if session.get(ToolSecret, payload.id):
        raise HTTPException(status_code=409, detail="密钥 ID 已存在")
    secret = ToolSecret(
        id=payload.id,
        org_id=context.organization.id,
        name=payload.name,
        value=encrypt_secret(payload.value),
        description=payload.description,
    )
    session.add(secret)
    session.commit()
    session.refresh(secret)
    return secret_to_read(secret)


@router.put("/secrets/{secret_id}", response_model=ToolSecretRead)
def update_secret(
    secret_id: str,
    payload: ToolSecretUpdate,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> ToolSecretRead:
    secret = get_secret_or_404(session, secret_id, context.organization.id)
    updates = payload.model_dump(exclude_unset=True)
    if "value" in updates:
        updates["value"] = encrypt_secret(updates["value"])
    for key, value in updates.items():
        setattr(secret, key, value)
    secret.updated_at = now_iso()
    session.add(secret)
    session.commit()
    session.refresh(secret)
    return secret_to_read(secret)


@router.delete("/secrets/{secret_id}")
def delete_secret(
    secret_id: str,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    secret = get_secret_or_404(session, secret_id, context.organization.id)
    usages = tool_secret_usage(secret_id, session, context.organization.id)
    if usages:
        tool_names = "、".join(sorted({item["tool_name"] or item["tool_id"] for item in usages})[:5])
        raise HTTPException(status_code=409, detail=f"密钥仍被 {len(usages)} 个工具或上线版本引用: {tool_names}")
    session.delete(secret)
    session.commit()
    return {"status": "deleted"}


@router.get("/audits", response_model=list[ToolInvocationAuditRead])
def tool_audits(
    tool_id: str | None = None,
    run_id: str | None = None,
    source: str | None = None,
    agent_id: str | None = None,
    conversation_id: str | None = None,
    call_id: str | None = None,
    limit: int = 50,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> list[ToolInvocationAuditRead]:
    if tool_id:
        get_tool_or_404(session, tool_id, context.organization.id)
    return list_tool_audits(
        session,
        context.organization.id,
        tool_id=tool_id,
        run_id=run_id,
        source=source,
        agent_id=agent_id,
        conversation_id=conversation_id,
        call_id=call_id,
        limit=limit,
    )


@router.post("/import/openapi", response_model=OpenAPIImportRead)
def import_openapi(
    payload: OpenAPIImportRequest,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> OpenAPIImportRead:
    try:
        tools, skipped = import_openapi_tools(
            session=session,
            spec=payload.spec,
            prefix=payload.prefix,
            category=payload.category,
            overwrite=payload.overwrite,
            allow_private_networks=payload.allow_private_networks,
            org_id=context.organization.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return OpenAPIImportRead(imported=len(tools), skipped=skipped, tools=tools)


@router.post("/mcp/discover", response_model=MCPDiscoveryRead)
async def discover_mcp(
    payload: MCPServerRequest,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> MCPDiscoveryRead:
    try:
        tools = await discover_mcp_tools(payload.metadata, session, org_id=context.organization.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"MCP server 发现失败: {exc}") from exc
    return MCPDiscoveryRead(tools=tools)


@router.post("/import/mcp", response_model=MCPImportRead)
async def import_mcp(
    payload: MCPImportRequest,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> MCPImportRead:
    try:
        tools, skipped = await import_mcp_tools(
            session=session,
            metadata=payload.metadata,
            prefix=payload.prefix,
            category=payload.category,
            tool_names=payload.tool_names,
            overwrite=payload.overwrite,
            org_id=context.organization.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"MCP server 导入失败: {exc}") from exc
    return MCPImportRead(imported=len(tools), skipped=skipped, tools=tools)


@router.post("", response_model=ToolRead)
def create_tool(
    payload: ToolCreate,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> ToolRead:
    if session.get(ToolDefinition, payload.id):
        raise HTTPException(status_code=409, detail="工具 ID 已存在")
    try:
        tool_def = create_tool_definition(payload, org_id=context.organization.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.add(tool_def)
    session.commit()
    session.refresh(tool_def)
    return tool_to_read(tool_def)


@router.put("/{tool_id}", response_model=ToolRead)
def update_tool(
    tool_id: str,
    payload: ToolUpdate,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> ToolRead:
    tool_def = get_tool_or_404(session, tool_id, context.organization.id)
    if tool_def.implementation == "builtin":
        raise HTTPException(status_code=400, detail="内置工具不可编辑")
    updates = payload.model_dump(exclude_unset=True)
    try:
        tool_def = update_tool_definition(tool_def, updates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.add(tool_def)
    session.commit()
    session.refresh(tool_def)
    return tool_to_read(tool_def)


@router.delete("/{tool_id}")
def delete_tool(
    tool_id: str,
    context: AuthContext = Depends(require_role("admin")),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    tool_def = get_tool_or_404(session, tool_id, context.organization.id)
    if tool_def.implementation == "builtin":
        raise HTTPException(status_code=400, detail="内置工具不可删除")
    usage = tool_deletion_usage(tool_id, session, context.organization.id)
    if usage.total:
        raise HTTPException(status_code=409, detail=tool_deletion_usage_detail(usage))
    session.delete(tool_def)
    session.commit()
    return {"status": "deleted"}


@router.post("/{tool_id}/invoke", response_model=ToolInvokeRead)
async def invoke(
    tool_id: str,
    payload: ToolInvokeRequest,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> ToolInvokeRead:
    try:
        output = await invoke_tool(
            tool_id,
            payload.input,
            session,
            context.organization.id,
            actor_role=context.membership.role,
            actor_user_id=context.user.id,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="工具不存在") from None
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ToolInvokeRead(tool_id=tool_id, output=output)
