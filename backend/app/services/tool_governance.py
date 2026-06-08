import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlmodel import Session, func, select

from app.config import settings
from app.core.models import Agent, AgentReleaseSnapshot, AgentRun, Skill, ToolDefinition, ToolInvocationAudit
from app.services.metadata_security import (
    SECRET_REF_SECTIONS,
    metadata_for_read,
    metadata_for_snapshot,
    reject_inline_secret_metadata,
    reject_sensitive_headers,
)
from app.services.mappers import _loads

ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAX_MCP_ARG_LENGTH = 500
MAX_MCP_ENV_VALUE_LENGTH = 4000


@dataclass(frozen=True)
class ToolDeletionUsage:
    agent_refs: int = 0
    skill_refs: int = 0
    release_refs: int = 0
    run_refs: int = 0
    audit_logs: int = 0

    @property
    def total(self) -> int:
        return self.agent_refs + self.skill_refs + self.release_refs + self.run_refs + self.audit_logs


def tool_deletion_usage(tool_id: str, session: Session, org_id: str) -> ToolDeletionUsage:
    release_refs = tool_release_usage(tool_id, session, org_id)
    audit_logs = int(
        session.exec(
            select(func.count())
            .select_from(ToolInvocationAudit)
            .where(ToolInvocationAudit.tool_id == tool_id, ToolInvocationAudit.org_id == org_id)
        ).one()
        or 0
    )
    return ToolDeletionUsage(
        agent_refs=_agent_tool_reference_count(session, tool_id, org_id),
        skill_refs=_skill_tool_reference_count(session, tool_id, org_id),
        release_refs=len(release_refs),
        run_refs=_run_tool_reference_count(session, tool_id, org_id),
        audit_logs=audit_logs,
    )


def tool_deletion_usage_detail(usage: ToolDeletionUsage) -> str:
    return (
        f"工具仍被 {usage.agent_refs} 项服务、{usage.skill_refs} 个能力、"
        f"{usage.release_refs} 个上线版本、{usage.run_refs} 条存量运行和 "
        f"{usage.audit_logs} 条工具运行证据引用"
    )


def tool_secret_usage(secret_id: str, session: Session, org_id: str) -> list[dict[str, str]]:
    usages: list[dict[str, str]] = []
    for tool_def in session.exec(select(ToolDefinition).where(ToolDefinition.org_id == org_id)).all():
        refs = tool_secret_refs(_loads(tool_def.metadata_json, {}))
        for ref_path, ref_secret_id in refs.items():
            if ref_secret_id == secret_id:
                usages.append(
                    {
                        "tool_id": tool_def.id,
                        "tool_name": tool_def.name,
                        "path": ref_path,
                    }
                )
    for release in session.exec(
        select(AgentReleaseSnapshot).where(AgentReleaseSnapshot.status == "published", AgentReleaseSnapshot.org_id == org_id)
    ).all():
        runtime_spec = _loads(release.runtime_spec_json, {})
        for tool in runtime_spec.get("tools") or []:
            if not isinstance(tool, dict):
                continue
            refs = tool_secret_refs(tool.get("metadata") or {})
            for ref_path, ref_secret_id in refs.items():
                if ref_secret_id == secret_id:
                    usages.append(
                        {
                            "tool_id": str(tool.get("id") or ""),
                            "tool_name": str(tool.get("name") or tool.get("id") or ""),
                            "path": f"release.v{release.version}.{ref_path}",
                            "release_id": release.id,
                            "agent_id": release.agent_id,
                        }
                    )
    return usages


def tool_release_usage(tool_id: str, session: Session, org_id: str) -> list[dict[str, str]]:
    usages: list[dict[str, str]] = []
    for release in session.exec(
        select(AgentReleaseSnapshot).where(AgentReleaseSnapshot.org_id == org_id)
    ).all():
        runtime_spec = _loads(release.runtime_spec_json, {})
        if _runtime_spec_references_tool(runtime_spec, tool_id):
            usages.append(
                {
                    "release_id": release.id,
                    "agent_id": release.agent_id,
                    "version": str(release.version),
                }
            )
    return usages


def _agent_tool_reference_count(session: Session, tool_id: str, org_id: str) -> int:
    count = 0
    for agent in session.exec(select(Agent).where(Agent.org_id == org_id)).all():
        if _agent_spec_references_tool(
            {
                "tools": _loads(agent.tools_json, []),
                "subagents": _loads(agent.subagents_json, []),
            },
            tool_id,
        ):
            count += 1
    return count


def _skill_tool_reference_count(session: Session, tool_id: str, org_id: str) -> int:
    count = 0
    for skill in session.exec(select(Skill).where(Skill.org_id == org_id)).all():
        if _tool_ids_include(_loads(skill.allowed_tools_json, []), tool_id):
            count += 1
    return count


def _run_tool_reference_count(session: Session, tool_id: str, org_id: str) -> int:
    count = 0
    for run in session.exec(select(AgentRun).where(AgentRun.org_id == org_id)).all():
        if _tool_ids_include(_loads(run.tools_json, []), tool_id):
            count += 1
            continue
        if _runtime_spec_references_tool(_loads(run.runtime_spec_json, {}), tool_id):
            count += 1
    return count


def _runtime_spec_references_tool(runtime_spec: dict[str, Any], tool_id: str) -> bool:
    if not isinstance(runtime_spec, dict):
        return False
    if _tool_ids_include(runtime_spec.get("tools") or [], tool_id):
        return True
    agent_spec = runtime_spec.get("agent") or {}
    if isinstance(agent_spec, dict) and _agent_spec_references_tool(agent_spec, tool_id):
        return True
    for skill in runtime_spec.get("skills") or []:
        if isinstance(skill, dict) and _tool_ids_include(skill.get("allowed_tools") or [], tool_id):
            return True
    return False


def _agent_spec_references_tool(agent_spec: dict[str, Any], tool_id: str) -> bool:
    if _tool_ids_include(agent_spec.get("tools") or [], tool_id):
        return True
    for subagent in agent_spec.get("subagents") or []:
        if isinstance(subagent, dict) and _tool_ids_include(subagent.get("tools") or [], tool_id):
            return True
    return False


def _tool_ids_include(items: Any, tool_id: str) -> bool:
    if not isinstance(items, list):
        return False
    return any(_tool_item_matches(item, tool_id) for item in items)


def _tool_item_matches(item: Any, tool_id: str) -> bool:
    if isinstance(item, dict):
        return str(item.get("id") or item.get("tool_id") or "") == tool_id
    return str(item) == tool_id


def tool_secret_refs(metadata: dict[str, Any]) -> dict[str, str]:
    refs: dict[str, str] = {}
    for section in SECRET_REF_SECTIONS:
        value = metadata.get(section) or {}
        if not isinstance(value, dict):
            continue
        for name, secret_id in value.items():
            if str(name).strip() and str(secret_id).strip():
                refs[f"{section}.{name}"] = str(secret_id)
    return refs


def validate_mcp_stdio_policy(metadata: dict[str, Any]) -> None:
    transport = _normalized_transport(metadata)
    if transport != "stdio":
        return
    if not settings.mcp_stdio_enabled:
        raise ValueError("MCP stdio 已被平台策略禁用")

    command = str(metadata.get("command") or "").strip()
    if not command:
        raise ValueError("MCP stdio 工具必须配置 command")
    _validate_stdio_command(command)
    _validate_stdio_args(metadata.get("args") or [])
    _validate_stdio_env(metadata.get("env") or {}, section="env")
    _validate_stdio_env(metadata.get("secret_env") or {}, section="secret_env")
    _validate_stdio_cwd(metadata)


def normalized_mcp_stdio_cwd(metadata: dict[str, Any]) -> str:
    cwd = str(metadata.get("cwd") or "").strip()
    if not cwd:
        raise ValueError("MCP stdio 必须配置受限 cwd")
    cwd_path = Path(cwd).expanduser()
    if not cwd_path.is_absolute():
        cwd_path = _stdio_cwd_root() / cwd_path
    return str(_safe_realpath(cwd_path))


def _normalized_transport(metadata: dict[str, Any]) -> str:
    transport = str(metadata.get("transport") or "http").strip()
    return "streamable_http" if transport == "streamable-http" else transport


def _validate_stdio_command(command: str) -> None:
    allowed = [str(item).strip() for item in settings.mcp_stdio_allowed_commands if str(item).strip()]
    if not allowed:
        raise ValueError("MCP stdio 必须配置 command allowlist")
    command_name = Path(command).name
    if command not in allowed and command_name not in allowed:
        raise ValueError("MCP stdio command 未在 allowlist 中")
    if any(char in command for char in ("\x00", "\n", "\r")):
        raise ValueError("MCP stdio command 包含非法字符")


def _validate_stdio_args(args: Any) -> None:
    if not isinstance(args, list):
        raise ValueError("MCP stdio args 必须是数组")
    for item in args:
        text = str(item)
        if len(text) > MAX_MCP_ARG_LENGTH or any(char in text for char in ("\x00", "\n", "\r")):
            raise ValueError("MCP stdio args 包含非法参数")


def _validate_stdio_env(env: Any, *, section: str) -> None:
    if not isinstance(env, dict):
        raise ValueError(f"MCP stdio {section} 必须是 JSON 对象")
    for key, value in env.items():
        key_text = str(key)
        value_text = str(value)
        if not ENV_NAME_RE.match(key_text):
            raise ValueError(f"MCP stdio {section} 包含非法环境变量名")
        if len(value_text) > MAX_MCP_ENV_VALUE_LENGTH or any(char in value_text for char in ("\x00", "\n", "\r")):
            raise ValueError(f"MCP stdio {section} 包含非法环境变量值")


def _validate_stdio_cwd(metadata: dict[str, Any]) -> None:
    cwd_real = Path(normalized_mcp_stdio_cwd(metadata))
    roots = [_safe_realpath(root) for root in settings.mcp_stdio_allowed_cwd_roots]
    if not roots or not any(_is_relative_to(cwd_real, root) for root in roots):
        raise ValueError("MCP stdio cwd 不在允许的工作目录范围内")


def _stdio_cwd_root() -> Path:
    roots = [root for root in settings.mcp_stdio_allowed_cwd_roots if str(root).strip()]
    return roots[0] if roots else settings.runtime_dir / "mcp"


def _safe_realpath(path: Path) -> Path:
    return Path(os.path.realpath(path.expanduser()))


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False
