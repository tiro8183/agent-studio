from urllib.parse import urlparse

from sqlmodel import Session, select

from app.core.models import ToolDefinition, ToolInvocationAudit, ToolSecret
from app.core.schemas import ToolHealthCheckRead, ToolHealthRead
from app.services.egress_policy import evaluate_url_egress
from app.services.mappers import _loads
from app.services.secret_codec import secret_configured
from app.services.tool_governance import tool_secret_refs
from app.services.tool_registry import tool_required_role, validate_tool_definition


def build_tool_health(tool_def: ToolDefinition, session: Session, org_id: str | None = None) -> ToolHealthRead:
    metadata = _metadata(tool_def)
    last_audit = _latest_invocation(tool_def, session, org_id or tool_def.org_id)
    checks = [
        ToolHealthCheckRead(
            key="status",
            label="启用状态",
            passed=tool_def.status == "active",
            severity="blocker",
            detail="工具必须启用才会进入 Agent 运行时。",
            evidence={"status": tool_def.status},
        ),
        _configuration_check(tool_def),
        _access_policy_check(tool_def),
        _secret_check(tool_def, session),
        _egress_check(tool_def),
        _last_invocation_check(last_audit),
    ]
    blockers = sum(1 for item in checks if not item.passed and item.severity == "blocker")
    warnings = sum(1 for item in checks if not item.passed and item.severity == "warning")
    scored = [item for item in checks if item.severity in {"blocker", "warning"}]
    score = round(sum(1 for item in scored if item.passed) / len(scored) * 100)
    return ToolHealthRead(
        tool_id=tool_def.id,
        name=tool_def.name,
        implementation=tool_def.implementation,
        status=tool_def.status,
        ready=blockers == 0,
        score=score,
        blockers=blockers,
        warnings=warnings,
        last_invocation_status=last_audit.status if last_audit else None,
        last_invoked_at=last_audit.created_at if last_audit else None,
        checks=checks,
    )


def build_tools_health(tool_defs: list[ToolDefinition], session: Session, org_id: str | None = None) -> list[ToolHealthRead]:
    return [build_tool_health(tool_def, session, org_id=org_id) for tool_def in tool_defs]


def _configuration_check(tool_def: ToolDefinition) -> ToolHealthCheckRead:
    try:
        validate_tool_definition(tool_def)
        return ToolHealthCheckRead(
            key="configuration",
            label="配置结构",
            passed=True,
            severity="blocker",
            detail="工具配置可被运行时构建。",
            evidence={"implementation": tool_def.implementation},
        )
    except ValueError as exc:
        return ToolHealthCheckRead(
            key="configuration",
            label="配置结构",
            passed=False,
            severity="blocker",
            detail=str(exc),
            evidence={"implementation": tool_def.implementation},
        )


def _access_policy_check(tool_def: ToolDefinition) -> ToolHealthCheckRead:
    try:
        required_role = tool_required_role(tool_def)
    except ValueError as exc:
        return ToolHealthCheckRead(
            key="access_policy",
            label="调用权限",
            passed=False,
            severity="blocker",
            detail=str(exc),
            evidence={"metadata": _metadata(tool_def)},
        )
    return ToolHealthCheckRead(
            key="access_policy",
            label="调用权限",
            passed=True,
            severity="info",
            detail=f"工具调用至少需要 {required_role} 角色。",
        evidence={"required_role": required_role},
    )


def _secret_check(tool_def: ToolDefinition, session: Session) -> ToolHealthCheckRead:
    refs = _secret_refs(tool_def)
    missing = [
        secret_id
        for secret_id in refs.values()
        if not (secret := session.get(ToolSecret, secret_id)) or secret.org_id != tool_def.org_id or not secret_configured(secret.value)
    ]
    return ToolHealthCheckRead(
        key="secrets",
        label="密钥引用",
        passed=not missing,
        severity="blocker",
        detail="所有密钥引用均已配置。" if not missing else f"缺失密钥: {', '.join(sorted(set(missing)))}",
        evidence={
            "refs": refs,
            "missing": sorted(set(missing)),
        },
    )


def _egress_check(tool_def: ToolDefinition) -> ToolHealthCheckRead:
    metadata = _metadata(tool_def)
    if tool_def.implementation == "builtin":
        return ToolHealthCheckRead(
            key="egress",
            label="访问边界",
            passed=True,
            severity="info",
            detail="内置工具不需要外部访问边界。",
            evidence={},
        )
    if tool_def.implementation == "mcp" and str(metadata.get("transport") or "http") == "stdio":
        return ToolHealthCheckRead(
            key="egress",
            label="访问边界",
            passed=True,
            severity="warning",
            detail="MCP stdio 不走外部访问边界，需满足平台 command allowlist 与 cwd 限制。",
            evidence={"command": str(metadata.get("command") or "")},
        )
    url = str(metadata.get("url") or "").strip()
    try:
        decision = evaluate_url_egress(metadata, url)
    except ValueError as exc:
        return ToolHealthCheckRead(
            key="egress",
            label="访问边界",
            passed=False,
            severity="blocker",
            detail=str(exc),
            evidence={"url": url},
        )
    policy = decision.tool_policy
    passed = decision.allowed and bool(decision.host)
    severity = "warning" if passed and (policy.allow_private_networks or decision.classification.is_private) else "blocker"
    detail = _egress_detail(decision.reason, policy.allow_private_networks)
    return ToolHealthCheckRead(
        key="egress",
        label="访问边界",
        passed=passed,
        severity=severity,
        detail=detail,
        evidence=decision.evidence(),
    )


def _last_invocation_check(last_audit: ToolInvocationAudit | None) -> ToolHealthCheckRead:
    if not last_audit:
        return ToolHealthCheckRead(
            key="last_invocation",
            label="最近连通测试",
            passed=False,
            severity="warning",
            detail="尚无工具连通测试证据，建议至少验证一次。",
            evidence={},
        )
    return ToolHealthCheckRead(
        key="last_invocation",
        label="最近连通测试",
        passed=last_audit.status == "success",
        severity="warning",
        detail="最近一次运行成功。" if last_audit.status == "success" else "最近一次运行失败，请查看工具运行证据。",
        evidence={
            "status": last_audit.status,
            "created_at": last_audit.created_at,
            "duration_ms": last_audit.duration_ms,
            "error": last_audit.error,
        },
    )


def _latest_invocation(tool_def: ToolDefinition, session: Session, org_id: str) -> ToolInvocationAudit | None:
    return session.exec(
        select(ToolInvocationAudit)
        .where(ToolInvocationAudit.tool_id == tool_def.id, ToolInvocationAudit.org_id == org_id)
        .order_by(ToolInvocationAudit.created_at.desc())
        .limit(1)
    ).first()


def _metadata(tool_def: ToolDefinition) -> dict:
    value = _loads(tool_def.metadata_json, {})
    return value if isinstance(value, dict) else {}


def _secret_refs(tool_def: ToolDefinition) -> dict[str, str]:
    return tool_secret_refs(_metadata(tool_def))


def _egress_detail(reason: str, allow_private_networks: bool) -> str:
    if reason == "allowed" and allow_private_networks:
        return "目标已通过平台与工具策略校验，但允许私有网络访问，请确认属于受控内网工具。"
    if reason == "allowed":
        return "目标已通过平台全局策略与工具 allowed_hosts 校验。"
    messages = {
        "missing_host": "出站 URL 缺少 host。",
        "global_blocked_host": "平台全局 blocked_hosts 拒绝该目标。",
        "tool_blocked_host": "工具 blocked_hosts 拒绝该目标。",
        "global_allowed_hosts_miss": "平台全局 allowed_hosts 未包含该目标。",
        "tool_allowed_hosts_miss": "工具 allowed_hosts 未包含该目标。",
        "global_localhost_denied": "平台全局策略禁止访问本机地址，工具级配置不能绕过。",
        "global_private_network_denied": "平台全局策略禁止访问私有网络，工具级配置不能绕过。",
        "tool_private_network_denied": "工具未允许访问私有网络。",
    }
    return messages.get(reason, f"访问边界拒绝该目标: {reason}")
