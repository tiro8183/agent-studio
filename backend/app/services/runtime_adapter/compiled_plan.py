from dataclasses import dataclass, field
from typing import Any

from app.core.schemas import AgentRuntimeManifestRead


@dataclass(frozen=True)
class CompiledRuntimePlan:
    agent_id: str
    agent_name: str
    system_prompt: str
    model: str
    llm_config_id: str
    backend_type: str
    checkpointing: bool
    debug: bool
    main_tools: list[dict[str, Any]] = field(default_factory=list)
    main_skills: list[dict[str, Any]] = field(default_factory=list)
    subagents: list[dict[str, Any]] = field(default_factory=list)
    model_contracts: list[dict[str, Any]] = field(default_factory=list)
    memory: list[str] = field(default_factory=list)
    interrupt_on: dict[str, bool] = field(default_factory=dict)
    permissions: dict[str, Any] = field(default_factory=dict)
    filesystem: dict[str, Any] = field(default_factory=dict)
    output: dict[str, Any] = field(default_factory=dict)
    harness: dict[str, Any] = field(default_factory=dict)
    knowledge: list[dict[str, Any]] = field(default_factory=list)
    missing_tools: list[str] = field(default_factory=list)
    missing_skills: list[str] = field(default_factory=list)
    inactive_tools: list[str] = field(default_factory=list)
    inactive_skills: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def main_tool_ids(self) -> list[str]:
        return _resource_ids(self.main_tools)

    @property
    def subagent_tool_ids(self) -> dict[str, list[str]]:
        return {
            str(subagent.get("name") or ""): _resource_ids(subagent.get("tools") or [])
            for subagent in self.subagents
            if subagent.get("name")
        }

    @property
    def subagent_by_name(self) -> dict[str, dict[str, Any]]:
        return {
            str(subagent.get("name") or ""): subagent
            for subagent in self.subagents
            if subagent.get("name")
        }

    def to_manifest_projection(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "engine_mode": "deepagents",
            "system_prompt": self.system_prompt,
            "model": self.model,
            "llm_config_id": self.llm_config_id,
            "backend_type": self.backend_type,
            "checkpointing": self.checkpointing,
            "debug": self.debug,
            "main_tools": self.main_tools,
            "main_skills": self.main_skills,
            "subagents": self.subagents,
            "model_contracts": self.model_contracts,
            "memory": self.memory,
            "interrupt_on": self.interrupt_on,
            "permissions": self.permissions,
            "filesystem": self.filesystem,
            "output": self.output,
            "harness": self.harness,
            "knowledge": self.knowledge,
            "missing_tools": self.missing_tools,
            "missing_skills": self.missing_skills,
            "inactive_tools": self.inactive_tools,
            "inactive_skills": self.inactive_skills,
            "warnings": self.warnings,
        }


def compile_runtime_plan(manifest: AgentRuntimeManifestRead) -> CompiledRuntimePlan:
    data = manifest.model_dump(mode="json")
    return CompiledRuntimePlan(
        agent_id=data["agent_id"],
        agent_name=data["agent_name"],
        system_prompt=data.get("system_prompt") or "",
        model=data["model"],
        llm_config_id=data["llm_config_id"],
        backend_type=data["backend_type"],
        checkpointing=data["checkpointing"],
        debug=data["debug"],
        main_tools=list(data.get("main_tools") or []),
        main_skills=list(data.get("main_skills") or []),
        subagents=list(data.get("subagents") or []),
        model_contracts=list(data.get("model_contracts") or []),
        memory=list(data.get("memory") or []),
        interrupt_on=dict(data.get("interrupt_on") or {}),
        permissions=dict(data.get("permissions") or {}),
        filesystem=dict(data.get("filesystem") or {}),
        output=dict(data.get("output") or {}),
        harness=dict(data.get("harness") or {}),
        knowledge=list(data.get("knowledge") or []),
        missing_tools=list(data.get("missing_tools") or []),
        missing_skills=list(data.get("missing_skills") or []),
        inactive_tools=list(data.get("inactive_tools") or []),
        inactive_skills=list(data.get("inactive_skills") or []),
        warnings=list(data.get("warnings") or []),
    )


def _resource_ids(resources: list[dict[str, Any]]) -> list[str]:
    return [str(item.get("id") or "") for item in resources if item.get("id")]
