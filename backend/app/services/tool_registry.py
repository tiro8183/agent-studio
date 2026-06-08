import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import perf_counter
from typing import Annotated, Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

from langchain_core.tools import BaseTool, InjectedToolCallId
from langchain_core.tools import StructuredTool, tool
from langchain_mcp_adapters.client import MultiServerMCPClient
from sqlmodel import Session, select

from app.core.models import ToolDefinition, ToolInvocationAudit, ToolSecret, now_iso
from app.core.schemas import ToolInvocationAuditRead, ToolRead, ToolSecretRead
from app.services.egress_policy import enforce_url_egress, host_matches, parse_tool_egress_policy
from app.services.mappers import _dumps, _loads
from app.services.secret_codec import decrypt_secret, secret_configured
from app.services.metadata_security import redact_sensitive_metadata, redact_sensitive_text
from app.services.tool_governance import (
    metadata_for_read,
    normalized_mcp_stdio_cwd,
    reject_inline_secret_metadata,
    reject_sensitive_headers,
    tool_secret_refs,
    validate_mcp_stdio_policy,
)

HTTP_METHODS = {"GET", "POST"}
MCP_TRANSPORTS = {"stdio", "http", "streamable_http", "streamable-http", "sse", "websocket"}
MAX_HTTP_OUTPUT_CHARS = 12000
PREVIEW_CHARS = 2000
TOOL_INVOKE_ROLE_RANK = {"viewer": 10, "editor": 20, "admin": 30, "owner": 40}
DEFAULT_TOOL_REQUIRED_ROLE = "editor"


@dataclass(frozen=True)
class ToolInvocationContext:
    user_id: str | None = None
    actor_role: str = "owner"
    source: str = "manual"
    agent_id: str | None = None
    run_id: str | None = None
    conversation_id: str | None = None
    call_id: str | None = None

    def with_defaults(
        self,
        *,
        actor_role: str | None = None,
        source: str | None = None,
        call_id: str | None = None,
    ) -> "ToolInvocationContext":
        return ToolInvocationContext(
            user_id=self.user_id,
            actor_role=actor_role if actor_role is not None else self.actor_role,
            source=source if source is not None else self.source,
            agent_id=self.agent_id,
            run_id=self.run_id,
            conversation_id=self.conversation_id,
            call_id=call_id if call_id is not None else self.call_id,
        )


def _invocation_context(
    context: ToolInvocationContext | None = None,
    *,
    actor_user_id: str | None = None,
    actor_role: str = "owner",
    source: str = "manual",
) -> ToolInvocationContext:
    if context is not None:
        return context.with_defaults(
            actor_role=context.actor_role or actor_role,
            source=context.source or source,
        )
    return ToolInvocationContext(user_id=actor_user_id, actor_role=actor_role, source=source)


def _context_with_call_id(context: ToolInvocationContext, call_id: str | None) -> ToolInvocationContext:
    if not call_id:
        return context
    return context.with_defaults(call_id=call_id)


@tool
def current_time() -> str:
    """Return the current UTC time in ISO 8601 format."""
    return datetime.now(timezone.utc).isoformat()


@tool
def word_count(text: str) -> str:
    """Count characters and words in a text snippet."""
    words = [part for part in text.split() if part]
    return f"chars={len(text)}, words={len(words)}"


@tool
def checklist(items: list[str]) -> str:
    """Format a short checklist from a list of work items."""
    return "\n".join(f"- [ ] {item}" for item in items)


_BUILTIN_TOOLS: dict[str, Callable] = {
    "current_time": current_time,
    "word_count": word_count,
    "checklist": checklist,
}


def tool_to_read(tool_def: ToolDefinition) -> ToolRead:
    return ToolRead(
        id=tool_def.id,
        org_id=tool_def.org_id,
        name=tool_def.name,
        description=tool_def.description,
        category=tool_def.category,
        enabled=tool_def.status == "active",
        implementation=tool_def.implementation,
        metadata=metadata_for_read(_metadata(tool_def)),
        status=tool_def.status,
        created_at=tool_def.created_at,
        updated_at=tool_def.updated_at,
    )


def list_tools(session: Session, org_id: str) -> list[ToolRead]:
    rows = session.exec(
        select(ToolDefinition)
        .where((ToolDefinition.org_id == org_id) | (ToolDefinition.implementation == "builtin"))
        .order_by(ToolDefinition.category, ToolDefinition.name)
    ).all()
    return [tool_to_read(row) for row in rows]


def secret_to_read(secret: ToolSecret) -> ToolSecretRead:
    return ToolSecretRead(
        id=secret.id,
        org_id=secret.org_id,
        name=secret.name,
        description=secret.description,
        configured=secret_configured(secret.value),
        created_at=secret.created_at,
        updated_at=secret.updated_at,
    )


def list_tool_secrets(session: Session, org_id: str) -> list[ToolSecretRead]:
    rows = session.exec(
        select(ToolSecret).where(ToolSecret.org_id == org_id).order_by(ToolSecret.name)
    ).all()
    return [secret_to_read(row) for row in rows]


def audit_to_read(audit: ToolInvocationAudit) -> ToolInvocationAuditRead:
    return ToolInvocationAuditRead(
        id=audit.id,
        org_id=audit.org_id,
        user_id=audit.user_id,
        actor_role=audit.actor_role,
        source=audit.source,
        agent_id=audit.agent_id,
        run_id=audit.run_id,
        conversation_id=audit.conversation_id,
        call_id=audit.call_id,
        tool_id=audit.tool_id,
        implementation=audit.implementation,
        status=audit.status,
        method=audit.method,
        url=audit.url,
        request_preview=audit.request_preview,
        response_preview=audit.response_preview,
        error=audit.error,
        duration_ms=audit.duration_ms,
        created_at=audit.created_at,
    )


def list_tool_audits(
    session: Session,
    org_id: str,
    tool_id: str | None = None,
    run_id: str | None = None,
    source: str | None = None,
    agent_id: str | None = None,
    conversation_id: str | None = None,
    call_id: str | None = None,
    limit: int = 50,
) -> list[ToolInvocationAuditRead]:
    stmt = select(ToolInvocationAudit).where(ToolInvocationAudit.org_id == org_id)
    if tool_id:
        stmt = stmt.where(ToolInvocationAudit.tool_id == tool_id)
    if run_id:
        stmt = stmt.where(ToolInvocationAudit.run_id == run_id)
    if source:
        stmt = stmt.where(ToolInvocationAudit.source == source)
    if agent_id:
        stmt = stmt.where(ToolInvocationAudit.agent_id == agent_id)
    if conversation_id:
        stmt = stmt.where(ToolInvocationAudit.conversation_id == conversation_id)
    if call_id:
        stmt = stmt.where(ToolInvocationAudit.call_id == call_id)
    stmt = stmt.order_by(ToolInvocationAudit.created_at.desc()).limit(min(limit, 200))
    return [audit_to_read(row) for row in session.exec(stmt).all()]


def load_tools(tool_ids: list[str], session: Session | None = None) -> list[Callable]:
    if session is None:
        return [_BUILTIN_TOOLS[tool_id] for tool_id in tool_ids if tool_id in _BUILTIN_TOOLS]

    rows = session.exec(
        select(ToolDefinition).where(ToolDefinition.id.in_(tool_ids), ToolDefinition.status == "active")
    ).all()
    rows_by_id = {row.id: row for row in rows}
    loaded: list[Callable] = []
    for tool_id in tool_ids:
        tool_def = rows_by_id.get(tool_id)
        if not tool_def:
            continue
        if tool_def.implementation == "builtin" and tool_id in _BUILTIN_TOOLS:
            loaded.append(_BUILTIN_TOOLS[tool_id])
        elif tool_def.implementation == "http":
            loaded.append(_http_structured_tool(tool_def, session))
    return loaded


async def load_tools_for_runtime(
    tool_ids: list[str],
    session: Session | None = None,
    actor_role: str = "owner",
    invocation_context: ToolInvocationContext | None = None,
) -> list[Callable]:
    if session is None:
        return load_tools(tool_ids, None)

    context = _invocation_context(invocation_context, actor_role=actor_role, source="runtime")
    return await load_tools_for_runtime_scope(tool_ids, session, "org_default", invocation_context=context)


async def load_tools_for_runtime_scope(
    tool_ids: list[str],
    session: Session,
    org_id: str,
    actor_role: str = "owner",
    invocation_context: ToolInvocationContext | None = None,
) -> list[Callable]:
    context = _invocation_context(invocation_context, actor_role=actor_role, source="runtime")
    rows = session.exec(
        select(ToolDefinition).where(
            ToolDefinition.id.in_(tool_ids),
            ToolDefinition.status == "active",
            (ToolDefinition.org_id == org_id) | (ToolDefinition.implementation == "builtin"),
        )
    ).all()
    rows_by_id = {row.id: row for row in rows}
    loaded: list[Callable] = []
    for tool_id in tool_ids:
        tool_def = rows_by_id.get(tool_id)
        if not tool_def:
            continue
        ensure_tool_invocable_by_role(tool_def, context.actor_role)
        if tool_def.implementation == "builtin" and tool_id in _BUILTIN_TOOLS:
            loaded.append(_builtin_structured_tool(tool_def, session, context))
        elif tool_def.implementation == "http":
            loaded.append(_http_structured_tool(tool_def, session, context))
        elif tool_def.implementation == "mcp":
            loaded.append(await _mcp_structured_tool(tool_def, session, context))
    return loaded


async def load_tools_for_runtime_snapshot(
    tool_ids: list[str],
    tool_snapshots: list[dict[str, Any]],
    session: Session | None = None,
    org_id: str = "org_default",
    actor_role: str = "owner",
    invocation_context: ToolInvocationContext | None = None,
) -> list[Callable]:
    context = _invocation_context(invocation_context, actor_role=actor_role, source="runtime")
    rows_by_id = {
        str(item.get("id")): ToolDefinition(
            id=str(item.get("id")),
            org_id=str(item.get("org_id") or org_id),
            name=str(item.get("name") or ""),
            description=str(item.get("description") or ""),
            category=str(item.get("category") or "custom"),
            implementation=str(item.get("implementation") or "builtin"),
            status=str(item.get("status") or "inactive"),
            metadata_json=_dumps(item.get("metadata") or {}),
        )
        for item in tool_snapshots
        if item.get("id")
    }
    loaded: list[Callable] = []
    for tool_id in tool_ids:
        tool_def = rows_by_id.get(tool_id)
        if not tool_def or tool_def.status != "active":
            continue
        ensure_tool_invocable_by_role(tool_def, context.actor_role)
        if tool_def.implementation == "builtin" and tool_id in _BUILTIN_TOOLS:
            loaded.append(_builtin_structured_tool(tool_def, session, context))
        elif tool_def.implementation == "http":
            loaded.append(_http_structured_tool(tool_def, session, context))
        elif tool_def.implementation == "mcp":
            loaded.append(await _mcp_structured_tool(tool_def, session, context))
    return loaded


def create_tool_definition(payload, org_id: str = "org_default") -> ToolDefinition:
    reject_inline_secret_metadata(payload.metadata or {})
    tool_def = ToolDefinition(
        id=payload.id,
        org_id=org_id,
        name=payload.name,
        description=payload.description,
        category=payload.category,
        implementation=payload.implementation,
        status=payload.status,
        metadata_json=_dumps(payload.metadata or {}),
    )
    validate_tool_definition(tool_def)
    return tool_def


async def invoke_tool(
    tool_id: str,
    payload,
    session: Session,
    org_id: str,
    actor_role: str = "owner",
    actor_user_id: str | None = None,
    invocation_context: ToolInvocationContext | None = None,
) -> str:
    context = _invocation_context(
        invocation_context,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        source="manual",
    )
    tool_def = session.get(ToolDefinition, tool_id)
    if not tool_def or tool_def.status != "active" or (tool_def.implementation != "builtin" and tool_def.org_id != org_id):
        raise KeyError(tool_id)
    ensure_tool_invocable_by_role(tool_def, context.actor_role)
    if tool_def.implementation == "http":
        return _invoke_http_tool(
            tool_def,
            payload,
            session,
            audit_org_id=org_id,
            invocation_context=context,
        )
    if tool_def.implementation == "mcp":
        return await _invoke_mcp_tool(
            tool_def,
            payload,
            session,
            audit_org_id=org_id,
            invocation_context=context,
        )
    if tool_def.implementation != "builtin" or tool_id not in _BUILTIN_TOOLS:
        raise KeyError(tool_id)
    started = perf_counter()
    try:
        output = _invoke_builtin_tool(tool_id, payload)
        _record_audit(
            session=session,
            tool_def=tool_def,
            org_id=org_id,
            status="success",
            request_payload=payload,
            response_text=output,
            duration_ms=int((perf_counter() - started) * 1000),
            invocation_context=context,
        )
        return output
    except Exception as exc:
        _record_audit(
            session=session,
            tool_def=tool_def,
            org_id=org_id,
            status="failed",
            request_payload=payload,
            error=str(exc),
            duration_ms=int((perf_counter() - started) * 1000),
            invocation_context=context,
        )
        raise


def update_tool_definition(tool_def: ToolDefinition, updates: dict) -> ToolDefinition:
    if "metadata" in updates:
        metadata = updates.pop("metadata") or {}
        reject_inline_secret_metadata(metadata)
        tool_def.metadata_json = _dumps(metadata)
    for key, value in updates.items():
        setattr(tool_def, key, value)
    validate_tool_definition(tool_def)
    tool_def.updated_at = now_iso()
    return tool_def


def validate_tool_definition(tool_def: ToolDefinition) -> None:
    tool_required_role(tool_def)
    if tool_def.implementation == "builtin":
        if tool_def.id not in _BUILTIN_TOOLS:
            raise ValueError("内置工具必须使用后端已注册的工具 ID")
        return
    if tool_def.implementation == "http":
        metadata = _metadata(tool_def)
        reject_inline_secret_metadata(metadata)
        _http_method(metadata)
        _http_url(metadata)
        _http_headers(metadata)
        _param_mapping(metadata)
        _secret_header_refs(metadata)
        _egress_policy(metadata)
        _http_timeout(metadata)
        return
    if tool_def.implementation == "mcp":
        metadata = _metadata(tool_def)
        reject_inline_secret_metadata(metadata)
        _mcp_connection(metadata, None)
        _mcp_target_tool(metadata)
        return
    raise ValueError("未知工具实现类型")


def _invoke_builtin_tool(tool_id: str, payload: Any) -> str:
    tool_fn = _BUILTIN_TOOLS[tool_id]
    if tool_id == "current_time":
        return str(tool_fn.invoke({}))
    if tool_id == "word_count":
        return str(tool_fn.invoke({"text": "" if payload is None else str(payload)}))
    if tool_id == "checklist":
        if isinstance(payload, list):
            items = [str(item) for item in payload]
        else:
            items = [part.strip() for part in str(payload or "").splitlines() if part.strip()]
        return str(tool_fn.invoke({"items": items}))
    return str(tool_fn.invoke(payload or {}))


def _metadata(tool_def: ToolDefinition) -> dict[str, Any]:
    metadata = _loads(tool_def.metadata_json, {})
    return metadata if isinstance(metadata, dict) else {}


def tool_required_role(tool_def: ToolDefinition) -> str:
    raw_role = _metadata(tool_def).get("required_role") or DEFAULT_TOOL_REQUIRED_ROLE
    role = str(raw_role).strip().lower()
    if role not in TOOL_INVOKE_ROLE_RANK:
        raise ValueError("工具 required_role 必须是 viewer/editor/admin/owner")
    return role


def ensure_tool_invocable_by_role(tool_def: ToolDefinition, actor_role: str) -> None:
    role = str(actor_role or "").strip().lower()
    if role not in TOOL_INVOKE_ROLE_RANK:
        raise PermissionError("当前成员角色无效，无法调用工具")
    required_role = tool_required_role(tool_def)
    if TOOL_INVOKE_ROLE_RANK[role] < TOOL_INVOKE_ROLE_RANK[required_role]:
        raise PermissionError(f"调用工具 {tool_def.name or tool_def.id} 需要 {required_role} 权限")


def validate_tool_bindings(
    session: Session,
    tool_ids: list[str],
    org_id: str,
    actor_role: str,
    *,
    label: str = "资源",
) -> None:
    ids = list(dict.fromkeys(str(item).strip() for item in tool_ids if str(item).strip()))
    if not ids:
        return
    role = str(actor_role or "").strip().lower()
    if role not in TOOL_INVOKE_ROLE_RANK:
        raise ValueError("当前成员角色无效，无法配置工具")
    rows = session.exec(
        select(ToolDefinition).where(
            ToolDefinition.id.in_(ids),
            (ToolDefinition.org_id == org_id) | (ToolDefinition.implementation == "builtin"),
        )
    ).all()
    tool_map = {row.id: row for row in rows}
    missing = [tool_id for tool_id in ids if tool_id not in tool_map]
    if missing:
        raise ValueError(f"{label}引用了未注册工具: {', '.join(missing)}")
    inactive = [row.id for row in tool_map.values() if row.status != "active"]
    if inactive:
        raise ValueError(f"{label}引用了未启用工具: {', '.join(inactive)}")
    forbidden = [
        f"{row.id}({tool_required_role(row)})"
        for row in tool_map.values()
        if TOOL_INVOKE_ROLE_RANK[role] < TOOL_INVOKE_ROLE_RANK[tool_required_role(row)]
    ]
    if forbidden:
        raise ValueError(f"当前角色不能配置这些高权限工具: {', '.join(forbidden)}")


def _http_method(metadata: dict[str, Any]) -> str:
    method = str(metadata.get("method") or "POST").upper()
    if method not in HTTP_METHODS:
        raise ValueError("HTTP 工具仅支持 GET 或 POST")
    return method


def _http_url(metadata: dict[str, Any]) -> str:
    url = str(metadata.get("url") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("HTTP 工具 URL 必须是合法的 http/https 地址")
    return url


def _http_headers(metadata: dict[str, Any]) -> dict[str, str]:
    headers = metadata.get("headers") or {}
    if not isinstance(headers, dict):
        raise ValueError("HTTP 工具 headers 必须是 JSON 对象")
    reject_sensitive_headers(headers, path="headers")
    return {str(key): str(value) for key, value in headers.items() if str(key).strip()}


def _param_mapping(metadata: dict[str, Any]) -> dict[str, dict[str, Any]]:
    mapping = metadata.get("param_mapping") or {}
    if not isinstance(mapping, dict):
        raise ValueError("HTTP 工具 param_mapping 必须是 JSON 对象")
    normalized: dict[str, dict[str, Any]] = {}
    for section in ("path", "query", "headers", "body"):
        value = mapping.get(section) or {}
        if not isinstance(value, dict):
            raise ValueError(f"HTTP 工具 param_mapping.{section} 必须是 JSON 对象")
        if section == "headers":
            reject_sensitive_headers(value, path="param_mapping.headers")
        normalized[section] = value
    return normalized


def _secret_header_refs(metadata: dict[str, Any]) -> dict[str, str]:
    headers = metadata.get("secret_headers") or {}
    if not isinstance(headers, dict):
        raise ValueError("HTTP 工具 secret_headers 必须是 JSON 对象")
    return {str(key): str(value) for key, value in headers.items() if str(key).strip() and str(value).strip()}


def _resolved_secret_headers(metadata: dict[str, Any], session: Session | None, org_id: str) -> dict[str, str]:
    refs = _secret_header_refs(metadata)
    if not refs:
        return {}
    if session is None:
        raise ValueError("HTTP 工具使用 secret_headers 时必须提供数据库会话")
    resolved: dict[str, str] = {}
    missing: list[str] = []
    for header_name, secret_id in refs.items():
        secret = session.get(ToolSecret, secret_id)
        if not secret or secret.org_id != org_id or not secret_configured(secret.value):
            missing.append(secret_id)
            continue
        resolved[header_name] = decrypt_secret(secret.value)
    if missing:
        raise ValueError(f"HTTP 工具引用的密钥不存在: {', '.join(missing)}")
    return resolved


def _http_timeout(metadata: dict[str, Any]) -> float:
    raw_timeout = metadata.get("timeout_seconds", 10)
    try:
        timeout = float(raw_timeout)
    except (TypeError, ValueError):
        raise ValueError("HTTP 工具 timeout_seconds 必须是数字") from None
    if timeout <= 0 or timeout > 60:
        raise ValueError("HTTP 工具 timeout_seconds 必须在 0 到 60 秒之间")
    return timeout


def _egress_policy(metadata: dict[str, Any]) -> dict[str, Any]:
    policy = parse_tool_egress_policy(metadata)
    return {
        "allowed_hosts": policy.allowed_hosts,
        "blocked_hosts": policy.blocked_hosts,
        "allow_private_networks": policy.allow_private_networks,
    }


def _host_matches(host: str, patterns: list[str]) -> bool:
    return host_matches(host, patterns)


def _enforce_egress_policy(metadata: dict[str, Any], url: str) -> None:
    enforce_url_egress(metadata, url)


def _normalize_http_payload(payload: Any) -> Any:
    if payload is None:
        return {}
    if isinstance(payload, str):
        stripped = payload.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                pass
        return {"input": payload}
    return payload


def _lookup_payload(payload: Any, source: Any) -> Any:
    if source == "$":
        return payload
    if source == "$body":
        return _normalize_http_payload(payload)
    if not isinstance(source, str):
        return None
    normalized = _normalize_http_payload(payload)
    if not isinstance(normalized, dict):
        return None
    current: Any = normalized
    for part in source.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _mapped_request(metadata: dict[str, Any], payload: Any) -> tuple[str, dict[str, str], Any, bool]:
    mapping = _param_mapping(metadata)
    if not any(mapping.values()):
        return _http_url(metadata), {}, _normalize_http_payload(payload), False

    url = _http_url(metadata)
    headers: dict[str, str] = {}
    for name, source in mapping["path"].items():
        value = _lookup_payload(payload, source)
        if value is not None:
            url = url.replace("{" + str(name) + "}", quote(str(value), safe=""))

    query: dict[str, Any] = {}
    for name, source in mapping["query"].items():
        value = _lookup_payload(payload, source)
        if value is not None:
            query[str(name)] = value
    if query:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{urlencode(query, doseq=True)}"

    for name, source in mapping["headers"].items():
        value = _lookup_payload(payload, source)
        if value is not None:
            headers[str(name)] = str(value)

    if "$" in mapping["body"]:
        body = _lookup_payload(payload, mapping["body"]["$"])
    else:
        body = {}
        for name, source in mapping["body"].items():
            value = _lookup_payload(payload, source)
            if value is not None:
                body[str(name)] = value
    return url, headers, body, True


def _http_body(payload: Any, headers: dict[str, str]) -> bytes:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if not any(key.lower() == "content-type" for key in headers):
        headers["Content-Type"] = "application/json"
    return body


def _append_query(url: str, payload: Any) -> str:
    payload = _normalize_http_payload(payload)
    if isinstance(payload, dict):
        query = urlencode({str(key): str(value) for key, value in payload.items()}, doseq=True)
    else:
        query = urlencode({"input": str(payload)})
    if not query:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{query}"


def _invoke_http_tool(
    tool_def: ToolDefinition,
    payload: Any,
    session: Session | None,
    audit_org_id: str | None = None,
    invocation_context: ToolInvocationContext | None = None,
) -> str:
    context = _invocation_context(invocation_context)
    metadata = _metadata(tool_def)
    method = _http_method(metadata)
    headers = _http_headers(metadata)
    request_url, mapped_headers, request_payload, used_mapping = _mapped_request(metadata, payload)
    headers.update(mapped_headers)
    headers.update(_resolved_secret_headers(metadata, session, tool_def.org_id))
    timeout = _http_timeout(metadata)
    if method == "GET" and not used_mapping:
        request_url = _append_query(request_url, request_payload)
    request_body = None if method == "GET" else _http_body(request_payload, headers)
    request = Request(request_url, data=request_body, headers=headers, method=method)
    started = perf_counter()
    try:
        _enforce_egress_policy(metadata, request_url)
        with urlopen(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            text = response.read(MAX_HTTP_OUTPUT_CHARS + 1).decode(charset, errors="replace")
            output = _truncate_output(text)
            if session is not None:
                _record_audit(
                    session=session,
                    tool_def=tool_def,
                    org_id=audit_org_id,
                    status="success",
                    method=method,
                    url=request_url,
                    request_payload=payload,
                    response_text=output,
                    duration_ms=int((perf_counter() - started) * 1000),
                    invocation_context=context,
                )
            return output
    except HTTPError as exc:
        body = exc.read(2000).decode("utf-8", errors="replace")
        error = f"HTTP 工具返回 {exc.code}: {body}"
        if session is not None:
            _record_audit(
                session,
                tool_def,
                "failed",
                method,
                request_url,
                payload,
                body,
                error,
                int((perf_counter() - started) * 1000),
                org_id=audit_org_id,
                invocation_context=context,
            )
        raise RuntimeError(error) from exc
    except (URLError, ValueError, RuntimeError) as exc:
        error = f"HTTP 工具请求失败: {getattr(exc, 'reason', exc)}"
        if session is not None:
            _record_audit(
                session,
                tool_def,
                "failed",
                method,
                request_url,
                payload,
                "",
                error,
                int((perf_counter() - started) * 1000),
                org_id=audit_org_id,
                invocation_context=context,
            )
        raise RuntimeError(error) from exc


def _mcp_timeout(metadata: dict[str, Any]) -> float:
    raw_timeout = metadata.get("timeout_seconds", 30)
    try:
        timeout = float(raw_timeout)
    except (TypeError, ValueError):
        raise ValueError("MCP 工具 timeout_seconds 必须是数字") from None
    if timeout <= 0 or timeout > 120:
        raise ValueError("MCP 工具 timeout_seconds 必须在 0 到 120 秒之间")
    return timeout


def _secret_env_refs(metadata: dict[str, Any]) -> dict[str, str]:
    refs = {
        key.replace("secret_env.", "", 1): value
        for key, value in tool_secret_refs(metadata).items()
        if key.startswith("secret_env.")
    }
    return {str(key): str(value) for key, value in refs.items() if str(key).strip() and str(value).strip()}


def _resolved_secret_env(metadata: dict[str, Any], session: Session | None, org_id: str) -> dict[str, str]:
    refs = _secret_env_refs(metadata)
    if not refs:
        return {}
    if session is None:
        raise ValueError("MCP 工具使用 secret_env 时必须提供数据库会话")
    resolved: dict[str, str] = {}
    missing: list[str] = []
    for env_name, secret_id in refs.items():
        secret = session.get(ToolSecret, secret_id)
        if not secret or secret.org_id != org_id or not secret_configured(secret.value):
            missing.append(secret_id)
            continue
        resolved[env_name] = decrypt_secret(secret.value)
    if missing:
        raise ValueError(f"MCP 工具引用的密钥不存在: {', '.join(missing)}")
    return resolved


def _mcp_target_tool(metadata: dict[str, Any]) -> str:
    target = str(metadata.get("tool_name") or "").strip()
    if not target:
        raise ValueError("MCP 工具必须配置 tool_name")
    return target


def _mcp_server_name(tool_def: ToolDefinition) -> str:
    return f"tool_{tool_def.id}"


def _mcp_headers(metadata: dict[str, Any], session: Session | None, org_id: str) -> dict[str, str]:
    headers = _http_headers(metadata)
    if session is None:
        _secret_header_refs(metadata)
        return headers
    headers.update(_resolved_secret_headers(metadata, session, org_id))
    return headers


def _mcp_connection(metadata: dict[str, Any], session: Session | None) -> dict[str, Any]:
    reject_inline_secret_metadata(metadata)
    transport = str(metadata.get("transport") or "http").strip()
    if transport not in MCP_TRANSPORTS:
        raise ValueError("MCP transport 必须是 stdio、http、streamable_http、sse 或 websocket")
    if transport == "streamable-http":
        transport = "streamable_http"

    timeout = _mcp_timeout(metadata)
    if transport == "stdio":
        validate_mcp_stdio_policy(metadata)
        command = str(metadata.get("command") or "").strip()
        if not command:
            raise ValueError("MCP stdio 工具必须配置 command")
        args = metadata.get("args") or []
        if not isinstance(args, list):
            raise ValueError("MCP stdio args 必须是数组")
        env = metadata.get("env") or {}
        if not isinstance(env, dict):
            raise ValueError("MCP stdio env 必须是 JSON 对象")
        connection: dict[str, Any] = {
            "transport": "stdio",
            "command": command,
            "args": [str(item) for item in args],
            "env": {str(key): str(value) for key, value in env.items() if str(key).strip()},
        }
        if session is None:
            _secret_env_refs(metadata)
        else:
            connection["env"].update(_resolved_secret_env(metadata, session, str(metadata.get("_org_id") or "org_default")))
        connection["cwd"] = normalized_mcp_stdio_cwd(metadata)
        return connection

    url = str(metadata.get("url") or "").strip()
    parsed = urlparse(url)
    schemes = {"websocket": {"ws", "wss"}}.get(transport, {"http", "https"})
    if parsed.scheme not in schemes or not parsed.netloc:
        raise ValueError("MCP 非 stdio 工具必须配置合法 url")
    _enforce_egress_policy(metadata, url)

    connection = {
        "transport": "http" if transport == "streamable_http" else transport,
        "url": url,
    }
    if transport in {"http", "streamable_http", "sse"}:
        connection["headers"] = _mcp_headers(metadata, session, str(metadata.get("_org_id") or "org_default"))
        connection["timeout"] = timedelta(seconds=timeout) if transport in {"http", "streamable_http"} else timeout
        connection["sse_read_timeout"] = timedelta(seconds=timeout) if transport in {"http", "streamable_http"} else timeout
    return connection


def mcp_connection(metadata: dict[str, Any], session: Session | None = None) -> dict[str, Any]:
    return _mcp_connection(metadata, session)


def _mcp_payload(payload: Any) -> dict[str, Any]:
    normalized = _normalize_http_payload(payload)
    if isinstance(normalized, dict):
        return normalized
    return {"input": normalized}


def _stringify_tool_output(output: Any) -> str:
    if isinstance(output, str):
        return output
    if isinstance(output, list):
        text_parts: list[str] = []
        for item in output:
            if isinstance(item, dict) and item.get("type") == "text":
                text_parts.append(str(item.get("text", "")))
            elif hasattr(item, "type") and getattr(item, "type") == "text":
                text_parts.append(str(getattr(item, "text", "")))
        if text_parts:
            return "\n".join(part for part in text_parts if part)
    return json.dumps(output, ensure_ascii=False, default=str)


def _remaining_timeout(deadline: float) -> float:
    remaining = deadline - perf_counter()
    if remaining <= 0:
        raise asyncio.TimeoutError
    return remaining


async def _matching_mcp_tool(
    tool_def: ToolDefinition,
    session: Session | None,
    timeout: float | None = None,
) -> BaseTool:
    metadata = _metadata(tool_def)
    metadata["_org_id"] = tool_def.org_id
    server_name = _mcp_server_name(tool_def)
    target_tool = _mcp_target_tool(metadata)
    client = MultiServerMCPClient({server_name: _mcp_connection(metadata, session)})
    tools = await asyncio.wait_for(
        client.get_tools(server_name=server_name),
        timeout=timeout if timeout is not None else _mcp_timeout(metadata),
    )
    for item in tools:
        if item.name == target_tool or item.name == f"{server_name}_{target_tool}":
            return item
    available = ", ".join(item.name for item in tools) or "无"
    raise ValueError(f"MCP server 未返回目标工具 {target_tool}；可用工具: {available}")


async def _invoke_mcp_tool(
    tool_def: ToolDefinition,
    payload: Any,
    session: Session | None,
    audit_org_id: str | None = None,
    invocation_context: ToolInvocationContext | None = None,
    resolved_tool: BaseTool | None = None,
) -> str:
    context = _invocation_context(invocation_context)
    started = perf_counter()
    metadata = _metadata(tool_def)
    total_timeout = _mcp_timeout(metadata)
    deadline = started + total_timeout
    request_payload = _mcp_payload(payload)
    url = str(metadata.get("url") or metadata.get("command") or "")
    transport = str(metadata.get("transport") or "http").strip()
    if transport == "streamable-http":
        transport = "streamable_http"
    method = f"MCP/{transport}:{_mcp_target_tool(metadata)}"
    phase = "发现"
    try:
        tool_item = resolved_tool or await _matching_mcp_tool(
            tool_def,
            session,
            timeout=_remaining_timeout(deadline),
        )
        phase = "调用"
        output = await asyncio.wait_for(
            tool_item.ainvoke(request_payload),
            timeout=_remaining_timeout(deadline),
        )
        text = _truncate_output(_stringify_tool_output(output))
        if session is not None:
            _record_audit(
                session=session,
                tool_def=tool_def,
                org_id=audit_org_id,
                status="success",
                method=method,
                url=url,
                request_payload=request_payload,
                response_text=text,
                duration_ms=int((perf_counter() - started) * 1000),
                invocation_context=context,
            )
        return text
    except asyncio.TimeoutError as exc:
        error = f"MCP 工具调用超时：总预算 {total_timeout:g} 秒，阶段：{phase}"
        if session is not None:
            _record_audit(
                session=session,
                tool_def=tool_def,
                org_id=audit_org_id,
                status="failed",
                method=method,
                url=url,
                request_payload=request_payload,
                error=error,
                duration_ms=int((perf_counter() - started) * 1000),
                invocation_context=context,
            )
        raise RuntimeError(error) from exc
    except ValueError as exc:
        error = f"MCP 工具{phase}失败: {exc}"
        if session is not None:
            _record_audit(
                session=session,
                tool_def=tool_def,
                org_id=audit_org_id,
                status="failed",
                method=method,
                url=url,
                request_payload=request_payload,
                error=error,
                duration_ms=int((perf_counter() - started) * 1000),
                invocation_context=context,
            )
        raise
    except Exception as exc:
        message = str(exc)
        error = message if message.startswith("MCP 工具") else f"MCP 工具{phase}失败: {message}"
        if session is not None:
            _record_audit(
                session=session,
                tool_def=tool_def,
                org_id=audit_org_id,
                status="failed",
                method=method,
                url=url,
                request_payload=request_payload,
                error=error,
                duration_ms=int((perf_counter() - started) * 1000),
                invocation_context=context,
            )
        raise RuntimeError(error) from exc


def _truncate_output(text: str) -> str:
    if len(text) <= MAX_HTTP_OUTPUT_CHARS:
        return text
    return f"{text[:MAX_HTTP_OUTPUT_CHARS]}\n...[truncated]"


def _preview(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return redact_sensitive_text(value)[:PREVIEW_CHARS]
    return json.dumps(redact_sensitive_metadata(value), ensure_ascii=False, default=str)[:PREVIEW_CHARS]


def _record_audit(
    session: Session,
    tool_def: ToolDefinition,
    status: str,
    method: str = "",
    url: str = "",
    request_payload: Any = None,
    response_text: str = "",
    error: str = "",
    duration_ms: int = 0,
    org_id: str | None = None,
    invocation_context: ToolInvocationContext | None = None,
) -> None:
    context = _invocation_context(invocation_context)
    session.add(
        ToolInvocationAudit(
            org_id=org_id or tool_def.org_id,
            user_id=context.user_id,
            actor_role=context.actor_role,
            source=context.source,
            agent_id=context.agent_id,
            run_id=context.run_id,
            conversation_id=context.conversation_id,
            call_id=context.call_id,
            tool_id=tool_def.id,
            implementation=tool_def.implementation,
            status=status,
            method=method,
            url=url,
            request_preview=_preview(request_payload),
            response_preview=_preview(response_text),
            error=_preview(error),
            duration_ms=duration_ms,
        )
    )
    session.commit()


def _builtin_structured_tool(
    tool_def: ToolDefinition,
    session: Session | None,
    invocation_context: ToolInvocationContext,
) -> StructuredTool:
    original_tool = _BUILTIN_TOOLS[tool_def.id]
    args_schema = getattr(original_tool, "args_schema", None)

    def invoke(tool_call_id: Annotated[str, InjectedToolCallId] = "", **kwargs: Any) -> str:
        started = perf_counter()
        payload = kwargs if kwargs else {}
        context = _context_with_call_id(invocation_context, tool_call_id)
        try:
            output = str(original_tool.invoke(payload))
            if session is not None:
                _record_audit(
                    session=session,
                    tool_def=tool_def,
                    org_id=tool_def.org_id,
                    status="success",
                    request_payload=payload,
                    response_text=output,
                    duration_ms=int((perf_counter() - started) * 1000),
                    invocation_context=context,
                )
            return output
        except Exception as exc:
            if session is not None:
                _record_audit(
                    session=session,
                    tool_def=tool_def,
                    org_id=tool_def.org_id,
                    status="failed",
                    request_payload=payload,
                    error=str(exc),
                    duration_ms=int((perf_counter() - started) * 1000),
                    invocation_context=context,
                )
            raise

    return StructuredTool.from_function(
        func=invoke,
        name=tool_def.id,
        description=tool_def.description or getattr(original_tool, "description", "") or tool_def.name,
        args_schema=args_schema,
    )


def _http_structured_tool(
    tool_def: ToolDefinition,
    session: Session | None,
    invocation_context: ToolInvocationContext | None = None,
) -> StructuredTool:
    context = _invocation_context(invocation_context, source="runtime")

    def invoke(input: Any = None, tool_call_id: Annotated[str, InjectedToolCallId] = "") -> str:
        return _invoke_http_tool(
            tool_def,
            input,
            session,
            audit_org_id=tool_def.org_id,
            invocation_context=_context_with_call_id(context, tool_call_id),
        )

    return StructuredTool.from_function(
        func=invoke,
        name=tool_def.id,
        description=tool_def.description or tool_def.name,
    )


async def _mcp_structured_tool(
    tool_def: ToolDefinition,
    session: Session | None,
    invocation_context: ToolInvocationContext | None = None,
) -> StructuredTool:
    context = _invocation_context(invocation_context, source="runtime")
    mcp_tool = await _matching_mcp_tool(tool_def, session)

    async def invoke(tool_call_id: Annotated[str, InjectedToolCallId] = "", **kwargs: Any) -> str:
        return await _invoke_mcp_tool(
            tool_def,
            kwargs,
            session,
            audit_org_id=tool_def.org_id,
            invocation_context=_context_with_call_id(context, tool_call_id),
            resolved_tool=mcp_tool,
        )

    return StructuredTool.from_function(
        coroutine=invoke,
        name=tool_def.id,
        description=tool_def.description or mcp_tool.description or tool_def.name,
        args_schema=mcp_tool.args_schema,
    )
