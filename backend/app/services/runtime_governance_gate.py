from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session

from app.core.models import LLMConfig, ToolDefinition, ToolSecret
from app.core.schemas import AgentRuntimeManifestRead
from app.services.egress_policy import evaluate_url_egress
from app.services.mappers import _loads
from app.services.secret_codec import secret_configured
from app.services.tool_governance import tool_secret_refs


@dataclass(frozen=True)
class RuntimeGovernanceIssue:
    key: str
    resource_type: str
    resource_id: str
    message: str
    evidence: dict[str, Any] = field(default_factory=dict)


class RuntimeGovernanceBlocked(ValueError):
    def __init__(self, issues: list[RuntimeGovernanceIssue]):
        self.issues = issues
        summary = "；".join(issue.message for issue in issues[:5])
        super().__init__(summary or "运行治理门阻断")


def assert_runtime_governance(
    *,
    manifest: AgentRuntimeManifestRead,
    session: Session,
    org_id: str,
) -> None:
    issues = runtime_governance_issues(manifest=manifest, session=session, org_id=org_id)
    if issues:
        raise RuntimeGovernanceBlocked(issues)


def runtime_governance_issues(
    *,
    manifest: AgentRuntimeManifestRead,
    session: Session,
    org_id: str,
) -> list[RuntimeGovernanceIssue]:
    issues: list[RuntimeGovernanceIssue] = []
    issues.extend(_llm_issues(manifest, session, org_id))
    issues.extend(_tool_issues(manifest, session, org_id))
    return issues


def _llm_issues(
    manifest: AgentRuntimeManifestRead,
    session: Session,
    org_id: str,
) -> list[RuntimeGovernanceIssue]:
    refs = _manifest_model_refs(manifest)
    issues: list[RuntimeGovernanceIssue] = []
    for ref in _unique_model_refs(refs):
        llm_config_id = ref["llm_config_id"]
        scope = ref["scope"]
        secret_ref = ref["api_key_ref"] or llm_config_id
        if not llm_config_id:
            issues.append(
                RuntimeGovernanceIssue(
                    key="provider_missing_ref",
                    resource_type="llm_config",
                    resource_id="",
                    message=f"{scope} 缺少模型通道引用",
                    evidence={"scope": scope},
                )
            )
            continue
        llm = session.get(LLMConfig, llm_config_id)
        if not llm or llm.org_id != org_id:
            issues.append(
                RuntimeGovernanceIssue(
                    key="provider_missing",
                    resource_type="llm_config",
                    resource_id=llm_config_id,
                    message=f"模型通道不存在: {llm_config_id}",
                    evidence={"scope": scope},
                )
            )
            continue
        if llm.status != "active":
            issues.append(
                RuntimeGovernanceIssue(
                    key="provider_inactive",
                    resource_type="llm_config",
                    resource_id=llm_config_id,
                    message=f"模型通道已停用: {llm.name or llm.id}",
                    evidence={"scope": scope, "status": llm.status},
                )
            )
            continue
        if not secret_configured(llm.api_key):
            issues.append(
                RuntimeGovernanceIssue(
                    key="provider_secret_missing",
                    resource_type="llm_config",
                    resource_id=llm_config_id,
                    message=f"模型通道密钥未配置: {llm.name or llm.id}",
                    evidence={"scope": scope, "secret_ref": secret_ref},
                )
            )
    return issues


def _manifest_model_refs(manifest: AgentRuntimeManifestRead) -> list[dict[str, str]]:
    if manifest.model_contracts:
        return [
            {
                "llm_config_id": str(contract.llm_config_id or ""),
                "scope": contract.subagent if contract.scope == "subagent" else "main",
                "api_key_ref": str(contract.api_key_ref or ""),
            }
            for contract in manifest.model_contracts
        ]
    refs = [{"llm_config_id": manifest.llm_config_id, "scope": "main", "api_key_ref": manifest.llm_config_id}]
    refs.extend(
        {
            "llm_config_id": subagent.llm_config_id or manifest.llm_config_id,
            "scope": subagent.name,
            "api_key_ref": subagent.llm_config_id or manifest.llm_config_id,
        }
        for subagent in manifest.subagents
    )
    return refs


def _tool_issues(
    manifest: AgentRuntimeManifestRead,
    session: Session,
    org_id: str,
) -> list[RuntimeGovernanceIssue]:
    issues: list[RuntimeGovernanceIssue] = []
    snapshots = _manifest_tool_snapshots(manifest)
    for tool_id in _manifest_tool_ids(manifest):
        tool_def = session.get(ToolDefinition, tool_id)
        if not tool_def or (tool_def.org_id != org_id and tool_def.implementation != "builtin"):
            issues.append(
                RuntimeGovernanceIssue(
                    key="tool_missing",
                    resource_type="tool",
                    resource_id=tool_id,
                    message=f"工具不存在: {tool_id}",
                )
            )
            continue
        if tool_def.status != "active":
            issues.append(
                RuntimeGovernanceIssue(
                    key="tool_inactive",
                    resource_type="tool",
                    resource_id=tool_id,
                    message=f"工具已停用: {tool_def.name or tool_def.id}",
                    evidence={"status": tool_def.status},
                )
            )
            continue
        snapshot = snapshots.get(tool_id) or {}
        frozen_tool = _frozen_tool(tool_def, snapshot)
        metadata = _frozen_metadata(tool_def, snapshot)
        issues.extend(_secret_issues(frozen_tool, metadata, session, org_id))
        issues.extend(_egress_issues(frozen_tool, metadata))
    return issues


def _manifest_tool_snapshots(manifest: AgentRuntimeManifestRead) -> dict[str, dict[str, Any]]:
    snapshots: dict[str, dict[str, Any]] = {}
    for resource in [*manifest.main_tools, *[tool for subagent in manifest.subagents for tool in subagent.tools]]:
        metadata = resource.metadata or {}
        if not isinstance(metadata, dict):
            continue
        snapshot = metadata.get("snapshot") or {}
        if isinstance(snapshot, dict) and resource.id:
            snapshots[resource.id] = snapshot
    return snapshots


def _frozen_tool(live_tool: ToolDefinition, snapshot: dict[str, Any]) -> ToolDefinition:
    return ToolDefinition(
        id=live_tool.id,
        org_id=str(snapshot.get("org_id") or live_tool.org_id),
        name=str(snapshot.get("name") or live_tool.name or live_tool.id),
        description=str(snapshot.get("description") or live_tool.description or ""),
        category=str(snapshot.get("category") or live_tool.category or ""),
        implementation=str(snapshot.get("implementation") or live_tool.implementation),
        status=live_tool.status,
        metadata_json="{}",
    )


def _frozen_metadata(live_tool: ToolDefinition, snapshot: dict[str, Any]) -> dict[str, Any]:
    metadata = snapshot.get("metadata") if snapshot else None
    if not isinstance(metadata, dict):
        metadata = _loads(live_tool.metadata_json, {})
    return metadata if isinstance(metadata, dict) else {}


def _secret_issues(
    tool_def: ToolDefinition,
    metadata: dict[str, Any],
    session: Session,
    org_id: str,
) -> list[RuntimeGovernanceIssue]:
    refs = tool_secret_refs(metadata)
    missing = [
        secret_id
        for secret_id in refs.values()
        if not (secret := session.get(ToolSecret, secret_id)) or secret.org_id != org_id or not secret_configured(secret.value)
    ]
    if not missing:
        return []
    return [
        RuntimeGovernanceIssue(
            key="tool_secret_missing",
            resource_type="tool",
            resource_id=tool_def.id,
            message=f"工具密钥不可用: {tool_def.name or tool_def.id}",
            evidence={"missing_secret_refs": sorted(set(missing)), "refs": refs},
        )
    ]


def _egress_issues(tool_def: ToolDefinition, metadata: dict[str, Any]) -> list[RuntimeGovernanceIssue]:
    if tool_def.implementation == "builtin":
        return []
    if tool_def.implementation == "mcp" and str(metadata.get("transport") or "http") == "stdio":
        return []
    url = str(metadata.get("url") or "").strip()
    try:
        decision = evaluate_url_egress(metadata, url)
    except ValueError as exc:
        return [
            RuntimeGovernanceIssue(
                key="tool_egress_invalid",
                resource_type="tool",
                resource_id=tool_def.id,
                message=f"工具访问边界配置无效: {tool_def.name or tool_def.id}",
                evidence={"url": url, "error": str(exc)},
            )
        ]
    if decision.allowed and decision.host:
        return []
    return [
        RuntimeGovernanceIssue(
            key="tool_egress_blocked",
            resource_type="tool",
            resource_id=tool_def.id,
            message=f"工具出站访问被治理策略阻断: {tool_def.name or tool_def.id}",
            evidence=decision.evidence(),
        )
    ]


def _manifest_tool_ids(manifest: AgentRuntimeManifestRead) -> list[str]:
    ids = [tool.id for tool in manifest.main_tools]
    for subagent in manifest.subagents:
        ids.extend(tool.id for tool in subagent.tools)
    return list(dict.fromkeys(tool_id for tool_id in ids if tool_id))


def _unique_model_refs(refs: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str, str, str]] = set()
    unique: list[dict[str, str]] = []
    for ref in refs:
        item = (
            str(ref.get("llm_config_id") or ""),
            str(ref.get("scope") or ""),
            str(ref.get("api_key_ref") or ""),
        )
        if item in seen:
            continue
        seen.add(item)
        unique.append(
            {
                "llm_config_id": item[0],
                "scope": item[1],
                "api_key_ref": item[2],
            }
        )
    return unique
