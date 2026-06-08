import asyncio
import re
from copy import deepcopy
from typing import Any

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from sqlmodel import Session

from app.core.models import ToolDefinition
from app.core.schemas import MCPDiscoveredToolRead, ToolRead
from app.services.mappers import _dumps
from app.services.tool_registry import mcp_connection, tool_to_read, validate_tool_definition

DEFAULT_MCP_DISCOVERY_TIMEOUT_SECONDS = 30


async def discover_mcp_tools(
    metadata: dict[str, Any],
    session: Session | None = None,
    org_id: str = "org_default",
) -> list[MCPDiscoveredToolRead]:
    tools = await _load_server_tools(metadata, session, org_id)
    return [
        MCPDiscoveredToolRead(
            name=tool.name,
            description=tool.description or "",
            args_schema=_tool_args_schema(tool),
        )
        for tool in tools
    ]


async def import_mcp_tools(
    session: Session,
    metadata: dict[str, Any],
    prefix: str = "",
    category: str = "mcp",
    tool_names: list[str] | None = None,
    overwrite: bool = False,
    org_id: str = "org_default",
) -> tuple[list[ToolRead], int]:
    available = await _load_server_tools(metadata, session, org_id)
    selected_names = set(tool_names or [])
    imported: list[ToolRead] = []
    skipped = 0

    for tool in available:
        if selected_names and tool.name not in selected_names:
            continue
        tool_def = _tool_to_definition(
            tool=tool,
            metadata=metadata,
            prefix=prefix,
            category=category,
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


async def _load_server_tools(metadata: dict[str, Any], session: Session | None, org_id: str) -> list[BaseTool]:
    if not isinstance(metadata, dict):
        raise ValueError("MCP metadata 必须是 JSON 对象")
    server_name = "discovery"
    connection_metadata = deepcopy(metadata)
    connection_metadata["_org_id"] = org_id
    client = MultiServerMCPClient({server_name: mcp_connection(connection_metadata, session)})
    return await asyncio.wait_for(
        client.get_tools(server_name=server_name),
        timeout=_discovery_timeout(metadata),
    )


def _discovery_timeout(metadata: dict[str, Any]) -> float:
    raw_timeout = metadata.get("timeout_seconds", DEFAULT_MCP_DISCOVERY_TIMEOUT_SECONDS)
    try:
        timeout = float(raw_timeout)
    except (TypeError, ValueError):
        raise ValueError("MCP 工具 timeout_seconds 必须是数字") from None
    if timeout <= 0 or timeout > 120:
        raise ValueError("MCP 工具 timeout_seconds 必须在 0 到 120 秒之间")
    return timeout


def _tool_to_definition(tool: BaseTool, metadata: dict[str, Any], prefix: str, category: str, org_id: str) -> ToolDefinition:
    tool_id = _safe_id("_".join(part for part in [prefix, tool.name] if part))
    next_metadata = deepcopy(metadata)
    next_metadata["tool_name"] = tool.name
    next_metadata["source"] = {
        "kind": "mcp",
        "server_transport": metadata.get("transport") or "http",
        "tool_name": tool.name,
    }
    return ToolDefinition(
        id=tool_id,
        org_id=org_id,
        name=tool.name[:120] or tool_id,
        description=(tool.description or tool.name or tool_id)[:1000],
        category=category or "mcp",
        implementation="mcp",
        status="active",
        metadata_json=_dumps(next_metadata),
    )


def _tool_args_schema(tool: BaseTool) -> dict[str, Any]:
    schema = getattr(tool, "args", None)
    if isinstance(schema, dict):
        return schema
    args_schema = getattr(tool, "args_schema", None)
    if isinstance(args_schema, dict):
        return args_schema
    if hasattr(args_schema, "model_json_schema"):
        return args_schema.model_json_schema()
    return {}


def _safe_id(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_")
    normalized = re.sub(r"_+", "_", normalized)
    return (normalized or "mcp_tool")[:64]
