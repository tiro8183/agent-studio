import ipaddress
import socket
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from app.config import settings


LOCALHOST_NAMES = {"localhost", "localhost.localdomain"}


@dataclass(frozen=True)
class EgressPolicySettings:
    allowed_hosts: list[str] = field(default_factory=list)
    blocked_hosts: list[str] = field(default_factory=list)
    allow_private_networks: bool = False
    allow_localhost: bool = False


@dataclass(frozen=True)
class ToolEgressPolicy:
    allowed_hosts: list[str] = field(default_factory=list)
    blocked_hosts: list[str] = field(default_factory=list)
    allow_private_networks: bool = False


@dataclass(frozen=True)
class HostClassification:
    host: str
    addresses: list[str] = field(default_factory=list)
    is_private: bool = False
    is_localhost: bool = False


@dataclass(frozen=True)
class EgressDecision:
    allowed: bool
    reason: str
    scheme: str
    host: str
    port: int | None
    tool_policy: ToolEgressPolicy
    global_policy: EgressPolicySettings
    classification: HostClassification

    def evidence(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "scheme": self.scheme,
            "host": self.host,
            "port": self.port,
            "addresses": self.classification.addresses,
            "is_private": self.classification.is_private,
            "is_localhost": self.classification.is_localhost,
            "tool_policy": {
                "allowed_hosts": self.tool_policy.allowed_hosts,
                "blocked_hosts": self.tool_policy.blocked_hosts,
                "allow_private_networks": self.tool_policy.allow_private_networks,
            },
            "global_policy": {
                "allowed_hosts": self.global_policy.allowed_hosts,
                "blocked_hosts": self.global_policy.blocked_hosts,
                "allow_private_networks": self.global_policy.allow_private_networks,
                "allow_localhost": self.global_policy.allow_localhost,
            },
        }


def settings_egress_policy() -> EgressPolicySettings:
    return EgressPolicySettings(
        allowed_hosts=_normalize_hosts(settings.egress_allowed_hosts),
        blocked_hosts=_normalize_hosts(settings.egress_blocked_hosts),
        allow_private_networks=settings.egress_allow_private_networks,
        allow_localhost=settings.egress_allow_localhost,
    )


def parse_tool_egress_policy(metadata: dict[str, Any]) -> ToolEgressPolicy:
    policy = metadata.get("egress_policy") or {}
    if not isinstance(policy, dict):
        raise ValueError("工具访问策略必须是 JSON 对象")
    allowed_hosts = policy.get("allowed_hosts") or []
    blocked_hosts = policy.get("blocked_hosts") or []
    if not isinstance(allowed_hosts, list) or not isinstance(blocked_hosts, list):
        raise ValueError("工具 allowed_hosts / blocked_hosts 必须是数组")
    return ToolEgressPolicy(
        allowed_hosts=_normalize_hosts(allowed_hosts),
        blocked_hosts=_normalize_hosts(blocked_hosts),
        allow_private_networks=bool(policy.get("allow_private_networks", False)),
    )


def evaluate_url_egress(
    metadata: dict[str, Any],
    url: str,
    *,
    settings: EgressPolicySettings | None = None,
) -> EgressDecision:
    global_policy = settings or settings_egress_policy()
    tool_policy = parse_tool_egress_policy(metadata)
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    classification = classify_host(host)
    reason = _decision_reason(host, tool_policy, global_policy, classification)
    return EgressDecision(
        allowed=reason == "allowed",
        reason=reason,
        scheme=parsed.scheme,
        host=host,
        port=_parsed_port(parsed),
        tool_policy=tool_policy,
        global_policy=global_policy,
        classification=classification,
    )


def enforce_url_egress(
    metadata: dict[str, Any],
    url: str,
    *,
    settings: EgressPolicySettings | None = None,
) -> EgressDecision:
    decision = evaluate_url_egress(metadata, url, settings=settings)
    if not decision.allowed:
        raise ValueError(_human_error(decision))
    return decision


def classify_host(host: str) -> HostClassification:
    normalized = host.lower()
    if not normalized:
        return HostClassification(host="")

    addresses: list[str] = []
    is_private = False
    is_localhost = normalized in LOCALHOST_NAMES
    try:
        ip = ipaddress.ip_address(normalized)
        addresses = [str(ip)]
        is_private = _is_restricted_ip(ip)
        is_localhost = is_localhost or ip.is_loopback
        return HostClassification(
            host=normalized,
            addresses=addresses,
            is_private=is_private,
            is_localhost=is_localhost,
        )
    except ValueError:
        pass

    try:
        resolved = socket.getaddrinfo(normalized, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return HostClassification(host=normalized, is_localhost=is_localhost)

    for *_, sockaddr in resolved:
        address = str(sockaddr[0])
        if address in addresses:
            continue
        addresses.append(address)
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            continue
        is_private = is_private or _is_restricted_ip(ip)
        is_localhost = is_localhost or ip.is_loopback
    return HostClassification(
        host=normalized,
        addresses=addresses,
        is_private=is_private,
        is_localhost=is_localhost,
    )


def host_matches(host: str, patterns: list[str]) -> bool:
    normalized = host.lower()
    for pattern in patterns:
        if pattern.startswith("*.") and normalized.endswith(pattern[1:]):
            return True
        if normalized == pattern:
            return True
    return False


def _decision_reason(
    host: str,
    tool_policy: ToolEgressPolicy,
    global_policy: EgressPolicySettings,
    classification: HostClassification,
) -> str:
    if not host:
        return "missing_host"
    if global_policy.blocked_hosts and host_matches(host, global_policy.blocked_hosts):
        return "global_blocked_host"
    if tool_policy.blocked_hosts and host_matches(host, tool_policy.blocked_hosts):
        return "tool_blocked_host"
    if global_policy.allowed_hosts and not host_matches(host, global_policy.allowed_hosts):
        return "global_allowed_hosts_miss"
    if tool_policy.allowed_hosts and not host_matches(host, tool_policy.allowed_hosts):
        return "tool_allowed_hosts_miss"
    if classification.is_localhost and not global_policy.allow_localhost:
        return "global_localhost_denied"
    if classification.is_private and not global_policy.allow_private_networks:
        return "global_private_network_denied"
    if classification.is_private and not tool_policy.allow_private_networks:
        return "tool_private_network_denied"
    return "allowed"


def _human_error(decision: EgressDecision) -> str:
    messages = {
        "missing_host": "工具访问地址缺少 host",
        "global_blocked_host": "平台全局访问边界拒绝访问该 host",
        "tool_blocked_host": "工具访问边界拒绝访问该 host",
        "global_allowed_hosts_miss": "平台全局访问边界未允许访问该 host",
        "tool_allowed_hosts_miss": "工具访问边界未允许访问该 host",
        "global_localhost_denied": "平台全局访问边界禁止访问本机 localhost；工具级配置不能绕过该限制",
        "global_private_network_denied": "平台全局访问边界禁止访问私有/本机网络；工具级配置不能绕过该限制",
        "tool_private_network_denied": "工具默认禁止访问私有/本机网络；如确需访问，请设置工具访问边界并确保平台全局策略允许",
    }
    return messages.get(decision.reason, f"工具访问边界拒绝访问该 host: {decision.reason}")


def _normalize_hosts(values: list[Any]) -> list[str]:
    return [str(item).strip().lower() for item in values if str(item).strip()]


def _parsed_port(parsed: Any) -> int | None:
    try:
        return parsed.port
    except ValueError:
        return None


def _is_restricted_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )
