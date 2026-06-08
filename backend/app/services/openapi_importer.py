import re
from copy import deepcopy
from typing import Any
from urllib.parse import urljoin, urlparse

from sqlmodel import Session

from app.core.models import ToolDefinition
from app.core.schemas import ToolRead
from app.services.mappers import _dumps
from app.services.tool_registry import tool_to_read, validate_tool_definition

SUPPORTED_METHODS = {"get", "post"}


def import_openapi_tools(
    session: Session,
    spec: dict[str, Any],
    prefix: str = "",
    category: str = "openapi",
    overwrite: bool = False,
    allow_private_networks: bool = False,
    org_id: str = "org_default",
) -> tuple[list[ToolRead], int]:
    if not isinstance(spec, dict):
        raise ValueError("OpenAPI spec 必须是 JSON 对象")
    paths = spec.get("paths") or {}
    if not isinstance(paths, dict):
        raise ValueError("OpenAPI spec.paths 必须是对象")

    imported: list[ToolRead] = []
    skipped = 0
    base_url = _base_url(spec)
    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        path_parameters = _parameters(spec, path_item.get("parameters") or [])
        for method, operation in path_item.items():
            if method.lower() not in SUPPORTED_METHODS or not isinstance(operation, dict):
                continue
            tool_def = _operation_to_tool(
                spec=spec,
                base_url=base_url,
                path=str(path),
                method=method.upper(),
                operation=operation,
                path_parameters=path_parameters,
                prefix=prefix,
                category=category,
                allow_private_networks=allow_private_networks,
                org_id=org_id,
            )
            existing = session.get(ToolDefinition, tool_def.id)
            if existing and existing.org_id != org_id:
                raise ValueError(f"工具 ID 已被其他组织占用: {tool_def.id}")
            if existing and not overwrite:
                skipped += 1
                continue
            validate_tool_definition(tool_def)
            if existing:
                existing.name = tool_def.name
                existing.description = tool_def.description
                existing.category = tool_def.category
                existing.implementation = tool_def.implementation
                existing.metadata_json = tool_def.metadata_json
                existing.status = tool_def.status
                session.add(existing)
                row = existing
            else:
                session.add(tool_def)
                row = tool_def
            session.commit()
            session.refresh(row)
            imported.append(tool_to_read(row))
    return imported, skipped


def _base_url(spec: dict[str, Any]) -> str:
    servers = spec.get("servers") or []
    if not servers or not isinstance(servers, list) or not isinstance(servers[0], dict):
        raise ValueError("OpenAPI spec.servers 至少需要一个 url")
    url = str(servers[0].get("url") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("OpenAPI server url 必须是合法 http/https 地址")
    return url.rstrip("/")


def _resolve_ref(spec: dict[str, Any], value: Any) -> Any:
    if not isinstance(value, dict) or "$ref" not in value:
        return value
    ref = str(value["$ref"])
    if not ref.startswith("#/"):
        raise ValueError("仅支持 OpenAPI 本地 $ref")
    current: Any = spec
    for part in ref[2:].split("/"):
        key = part.replace("~1", "/").replace("~0", "~")
        if not isinstance(current, dict) or key not in current:
            raise ValueError(f"OpenAPI $ref 无法解析: {ref}")
        current = current[key]
    return deepcopy(current)


def _parameters(spec: dict[str, Any], raw_parameters: list[Any]) -> list[dict[str, Any]]:
    parameters: list[dict[str, Any]] = []
    for item in raw_parameters:
        resolved = _resolve_ref(spec, item)
        if isinstance(resolved, dict):
            parameters.append(resolved)
    return parameters


def _operation_to_tool(
    spec: dict[str, Any],
    base_url: str,
    path: str,
    method: str,
    operation: dict[str, Any],
    path_parameters: list[dict[str, Any]],
    prefix: str,
    category: str,
    allow_private_networks: bool,
    org_id: str,
) -> ToolDefinition:
    operation_id = str(operation.get("operationId") or "").strip()
    raw_id = operation_id or f"{method.lower()}_{path.strip('/') or 'root'}"
    tool_id = _safe_id("_".join(part for part in [prefix, raw_id] if part))
    parameters = [*path_parameters, *_parameters(spec, operation.get("parameters") or [])]
    request_body_schema = _request_body_schema(spec, operation.get("requestBody"))
    url = urljoin(f"{base_url}/", path.lstrip("/"))
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    metadata = {
        "url": url,
        "method": method,
        "headers": {},
        "secret_headers": {},
        "timeout_seconds": 15,
        "egress_policy": {
            "allowed_hosts": [host] if host else [],
            "blocked_hosts": [],
            "allow_private_networks": allow_private_networks,
        },
        "param_mapping": _param_mapping(parameters, request_body_schema),
        "source": {
            "kind": "openapi",
            "operation_id": operation_id,
            "path": path,
        },
    }
    summary = str(operation.get("summary") or operation_id or tool_id)
    description = str(operation.get("description") or summary)
    return ToolDefinition(
        id=tool_id,
        org_id=org_id,
        name=summary[:120] or tool_id,
        description=description[:1000],
        category=category or "openapi",
        implementation="http",
        status="active",
        metadata_json=_dumps(metadata),
    )


def _safe_id(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_")
    normalized = re.sub(r"_+", "_", normalized)
    return (normalized or "openapi_tool")[:64]


def _param_mapping(parameters: list[dict[str, Any]], request_body_schema: dict[str, Any] | None) -> dict[str, Any]:
    mapping: dict[str, Any] = {"path": {}, "query": {}, "headers": {}, "body": {}}
    for parameter in parameters:
        name = str(parameter.get("name") or "").strip()
        location = str(parameter.get("in") or "").strip()
        if not name or location not in {"path", "query", "header"}:
            continue
        source = name
        if location == "header":
            mapping["headers"][name] = source
        elif location == "query":
            mapping["query"][name] = source
        else:
            mapping["path"][name] = source
    if request_body_schema:
        properties = request_body_schema.get("properties") if isinstance(request_body_schema, dict) else None
        if isinstance(properties, dict):
            mapping["body"] = {str(name): str(name) for name in properties.keys()}
        else:
            mapping["body"] = {"$": "$body"}
    return mapping


def _request_body_schema(spec: dict[str, Any], request_body: Any) -> dict[str, Any] | None:
    resolved = _resolve_ref(spec, request_body)
    if not isinstance(resolved, dict):
        return None
    content = resolved.get("content") or {}
    if not isinstance(content, dict):
        return None
    media = content.get("application/json") or content.get("application/*+json")
    if not isinstance(media, dict):
        return None
    schema = _resolve_ref(spec, media.get("schema"))
    return schema if isinstance(schema, dict) else None
