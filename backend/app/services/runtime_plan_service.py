import json
from dataclasses import dataclass
from typing import Any, Literal

from sqlmodel import Session

from app.core.models import Agent, AgentReleaseSnapshot, AgentRun, LLMConfig, new_id
from app.core.schemas import AgentRuntimeManifestRead
from app.services.llm_runtime_contract import find_llm_contract, llm_config_from_contract
from app.services.mappers import _dumps, _loads
from app.services.runtime_manifest_hash import hash_runtime_manifest
from app.services.runtime_manifest_service import build_runtime_manifest_from_spec
from app.services.runtime_snapshot_service import (
    build_runtime_spec,
    latest_release_snapshot,
    runtime_spec_from_release,
    spec_hash_for_runtime_spec,
)

RuntimePlanSource = Literal["preview", "publish", "release", "snapshot"]


@dataclass(frozen=True)
class RuntimePlan:
    agent_id: str
    org_id: str
    agent_name: str
    runtime_spec: dict[str, Any]
    runtime_manifest: AgentRuntimeManifestRead
    runtime_manifest_json: str
    spec_hash: str
    manifest_hash: str
    source: RuntimePlanSource
    release_id: str | None = None
    agent_version: int = 1

    @property
    def agent_spec(self) -> dict[str, Any]:
        return self.runtime_spec.get("agent", {})

    @property
    def model(self) -> str:
        return str(self.agent_spec.get("model") or "")

    @property
    def llm_config_id(self) -> str:
        return str(self.agent_spec.get("llm_config_id") or "")

    def llm_contract(self, llm_config_id: str | None = None) -> dict[str, Any] | None:
        return find_llm_contract(self.runtime_spec.get("llm_configs") or [], llm_config_id or self.llm_config_id)

    def llm_config_from_contract(
        self,
        llm_config_id: str | None = None,
        api_key: str = "",
        *,
        scope: str = "",
        subagent: str = "",
        model: str = "",
    ) -> LLMConfig | None:
        item = self.llm_contract(llm_config_id)
        if not item:
            return None
        model_contract = self._model_contract_for_llm(llm_config_id, scope=scope, subagent=subagent, model=model)
        default_model = model_contract.model if model_contract else self.model
        return llm_config_from_contract(item, org_id=self.org_id, default_model=default_model, api_key=api_key)

    @property
    def has_mixed_llm_usage(self) -> bool:
        main = next((item for item in self.llm_usage_contracts() if item.get("scope") == "main"), None)
        if not main:
            return False
        for contract in self.llm_usage_contracts():
            if contract.get("scope") != "subagent":
                continue
            if (
                str(contract.get("llm_config_id") or "") != str(main.get("llm_config_id") or "")
                or str(contract.get("model") or "") != str(main.get("model") or "")
            ):
                return True
        return False

    def llm_usage_contracts(self) -> list[dict[str, Any]]:
        contracts = [self._llm_usage_contract(item) for item in self.runtime_manifest.model_contracts]
        seen: set[tuple[str, str, str, str]] = set()
        unique_contracts: list[dict[str, Any]] = []
        for item in contracts:
            key = (
                str(item.get("scope") or ""),
                str(item.get("subagent") or ""),
                str(item.get("llm_config_id") or ""),
                str(item.get("model") or ""),
            )
            if key in seen:
                continue
            seen.add(key)
            unique_contracts.append(item)
        return unique_contracts

    def _llm_usage_contract(self, contract) -> dict[str, Any]:
        return {
            "scope": str(contract.scope or "main"),
            "subagent": str(contract.subagent or ""),
            "llm_config_id": str(contract.llm_config_id or ""),
            "provider_type": str(contract.provider_type or ""),
            "model": str(contract.model or ""),
        }

    def _model_contract_for_llm(
        self,
        llm_config_id: str | None,
        *,
        scope: str = "",
        subagent: str = "",
        model: str = "",
    ):
        target = str(llm_config_id or self.llm_config_id)
        for contract in self.runtime_manifest.model_contracts:
            if str(contract.llm_config_id or "") != target:
                continue
            if scope and str(contract.scope or "") != scope:
                continue
            if subagent and str(contract.subagent or "") != subagent:
                continue
            if model and str(contract.model or "") != model:
                continue
            return contract
        return None

    @property
    def max_iterations(self) -> int:
        return int(self.agent_spec.get("max_iterations") or 8)

    @property
    def thread_scope(self) -> str:
        return self.release_id or f"{self.source}:{self.agent_id}:{self.agent_version}:{self.spec_hash[:12]}"

    @property
    def knowledge_count(self) -> int:
        return len(self.runtime_manifest.knowledge)

    @property
    def runtime_spec_json(self) -> str:
        return _dumps(self.runtime_spec)

    @property
    def tools_json(self) -> str:
        tool_ids = [item.id for item in self.runtime_manifest.main_tools]
        for subagent in self.runtime_manifest.subagents:
            tool_ids.extend(item.id for item in subagent.tools)
        return _dumps(list(dict.fromkeys(item for item in tool_ids if item)))

    @property
    def subagents_json(self) -> str:
        return _dumps(self.agent_spec.get("subagents") or [])


def build_preview_runtime_plan(agent: Agent, session: Session) -> RuntimePlan:
    runtime_spec = build_runtime_spec(agent, session)
    agent_version = int(runtime_spec.get("agent", {}).get("version") or agent.version or 1)
    return _plan_from_spec(
        agent=agent,
        runtime_spec=runtime_spec,
        source="preview",
        release_id=None,
        agent_version=agent_version,
    )


def build_publish_runtime_plan(
    agent: Agent,
    session: Session,
    version: int,
    published_at: str,
) -> RuntimePlan:
    runtime_spec = build_runtime_spec(agent, session, strict_llm_contract=True)
    runtime_spec["agent"]["version"] = version
    runtime_spec["agent"]["status"] = "published"
    runtime_spec["agent"]["published_at"] = published_at
    return _plan_from_spec(
        agent=agent,
        runtime_spec=runtime_spec,
        source="publish",
        release_id=None,
        agent_version=version,
    )


def build_release_runtime_plan(agent: Agent, release: AgentReleaseSnapshot) -> RuntimePlan:
    runtime_spec = runtime_spec_from_release(release)
    return _plan_from_spec(
        agent=agent,
        runtime_spec=runtime_spec,
        source="release",
        release_id=release.id,
        agent_version=release.version,
        runtime_manifest_json=release.runtime_manifest_json,
        spec_hash=release.spec_hash,
        manifest_hash=getattr(release, "manifest_hash", "") or None,
    )


def build_run_snapshot_runtime_plan(agent: Agent, run: AgentRun) -> RuntimePlan:
    runtime_spec = _loads(run.runtime_spec_json, {})
    if not runtime_spec:
        raise ValueError("源运行缺少运行快照，不能按原版本重跑")
    return _plan_from_spec(
        agent=agent,
        runtime_spec=runtime_spec,
        source="snapshot",
        release_id=run.release_id,
        agent_version=run.agent_version,
        runtime_manifest_json=run.runtime_manifest_json,
        spec_hash=run.spec_hash or spec_hash_for_runtime_spec(runtime_spec),
        manifest_hash=hash_runtime_manifest(_manifest_from_json(run.runtime_manifest_json, runtime_spec)),
    )


def build_runtime_plan(agent: Agent, session: Session, org_id: str, preview: bool) -> RuntimePlan | None:
    if preview:
        return build_preview_runtime_plan(agent, session)
    release = latest_release_snapshot(session, agent.id, org_id)
    if not release:
        return None
    return build_release_runtime_plan(agent, release)


def create_release_snapshot_from_plan(plan: RuntimePlan, session: Session) -> AgentReleaseSnapshot:
    snapshot = AgentReleaseSnapshot(
        id=new_id("release"),
        org_id=plan.org_id,
        agent_id=plan.agent_id,
        version=plan.agent_version,
        agent_spec_json=_dumps(plan.agent_spec),
        runtime_spec_json=plan.runtime_spec_json,
        runtime_manifest_json=plan.runtime_manifest_json,
        spec_hash=plan.spec_hash,
        manifest_hash=plan.manifest_hash,
    )
    session.add(snapshot)
    return snapshot


def _plan_from_spec(
    *,
    agent: Agent,
    runtime_spec: dict[str, Any],
    source: RuntimePlanSource,
    release_id: str | None,
    agent_version: int,
    runtime_manifest_json: str | None = None,
    spec_hash: str | None = None,
    manifest_hash: str | None = None,
) -> RuntimePlan:
    runtime_manifest = _manifest_from_json(runtime_manifest_json, runtime_spec)
    manifest_json = _dumps(runtime_manifest)
    computed_manifest_hash = hash_runtime_manifest(runtime_manifest)
    resolved_manifest_hash = manifest_hash if manifest_hash == computed_manifest_hash else computed_manifest_hash
    return RuntimePlan(
        agent_id=str(runtime_spec.get("agent", {}).get("id") or agent.id),
        org_id=str(runtime_spec.get("agent", {}).get("org_id") or agent.org_id),
        agent_name=str(runtime_spec.get("agent", {}).get("name") or agent.name),
        runtime_spec=runtime_spec,
        runtime_manifest=runtime_manifest,
        runtime_manifest_json=manifest_json,
        spec_hash=spec_hash or spec_hash_for_runtime_spec(runtime_spec),
        manifest_hash=resolved_manifest_hash,
        source=source,
        release_id=release_id,
        agent_version=agent_version,
    )


def _manifest_from_json(
    runtime_manifest_json: str | None,
    runtime_spec: dict[str, Any],
) -> AgentRuntimeManifestRead:
    if runtime_manifest_json:
        try:
            data = _loads(runtime_manifest_json, {})
            if isinstance(data, dict) and data.get("model_contracts"):
                return AgentRuntimeManifestRead(**data)
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    return build_runtime_manifest_from_spec(runtime_spec)
