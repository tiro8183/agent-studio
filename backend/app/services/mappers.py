import json
from typing import Any

from app.core.models import Agent, LLMConfig
from app.core.schemas import (
    AgentCreate,
    AgentRead,
    ContextConfig,
    FilesystemConfig,
    HarnessConfig,
    LLMConfigCreate,
    LLMConfigRead,
    ModelConfig,
    ModelOverride,
    OutputConfig,
    PermissionConfig,
    RoutingConfig,
    RuntimeConfig,
)
from app.services.secret_codec import encrypt_secret, secret_configured
from app.services.metadata_security import metadata_for_read, reject_sensitive_headers
from app.services.llm_provider_policy import validate_default_model, validate_llm_provider_contract


def _loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value) if value else fallback
    except json.JSONDecodeError:
        return fallback


def _dumps(value: Any) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump()
    elif isinstance(value, list):
        value = [item.model_dump() if hasattr(item, "model_dump") else item for item in value]
    elif isinstance(value, dict):
        value = {
            key: item.model_dump() if hasattr(item, "model_dump") else item
            for key, item in value.items()
        }
    return json.dumps(value, ensure_ascii=False)


def llm_to_read(config: LLMConfig) -> LLMConfigRead:
    return LLMConfigRead(
        id=config.id,
        org_id=config.org_id,
        name=config.name,
        provider_type=config.provider_type,
        api_key="",
        api_key_configured=secret_configured(config.api_key),
        base_url=config.base_url,
        available_models=[
            ModelConfig(**item)
            for item in _loads(config.available_models_json, [])
        ],
        default_model=config.default_model,
        temperature=config.temperature,
        max_tokens=config.max_tokens,
        extra_headers=metadata_for_read(_loads(config.extra_headers_json, {})),
        status=config.status,
        last_check_status=config.last_check_status,
        last_check_message=config.last_check_message,
        last_checked_at=config.last_checked_at,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


def llm_from_create(config_id: str, payload: LLMConfigCreate, org_id: str = "org_default") -> LLMConfig:
    reject_sensitive_headers(payload.extra_headers, path="extra_headers")
    provider_type, base_url = validate_llm_provider_contract(payload.provider_type, payload.base_url)
    default_model = validate_default_model(payload.default_model, list(payload.available_models))
    return LLMConfig(
        id=config_id,
        org_id=org_id,
        name=payload.name,
        provider_type=provider_type,
        api_key=encrypt_secret(payload.api_key),
        base_url=base_url,
        available_models_json=_dumps([m.model_dump() for m in payload.available_models]),
        default_model=default_model,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        extra_headers_json=_dumps(payload.extra_headers),
        status=payload.status,
    )


def agent_to_read(
    agent: Agent,
    *,
    current_spec_hash: str = "",
    latest_release_spec_hash: str = "",
    config_pending_publish: bool = False,
) -> AgentRead:
    return AgentRead(
        id=agent.id,
        org_id=agent.org_id,
        name=agent.name,
        slug=agent.slug,
        description=agent.description,
        system_prompt=agent.system_prompt,
        llm_config_id=agent.llm_config_id,
        model=agent.model,
        engine_mode="deepagents",
        tools=_loads(agent.tools_json, []),
        skills=_loads(agent.skills_json, []),
        subagents=_loads(agent.subagents_json, []),
        memory=_loads(agent.memory_json, []),
        filesystem=FilesystemConfig(**_loads(agent.filesystem_json, {"enabled": True, "mode": "virtual", "read_only": False})),
        permissions=PermissionConfig(**_loads(agent.permissions_json, {"allow_write": True, "allowed_paths": ["/workspace/**", "/skills/**"]})),
        runtime=RuntimeConfig(**_loads(agent.runtime_json, {"backend_type": "filesystem", "debug": False, "checkpointing": False, "interrupt_on": {}})),
        output=OutputConfig(**_loads(agent.output_json, {"mode": "text", "json_schema": {}})),
        harness=HarnessConfig(**_loads(agent.harness_json, {"excluded_tools": [], "tool_description_overrides": {}, "disable_general_purpose_subagent": False})),
        metadata=_loads(agent.metadata_json, {}),
        model_override=ModelOverride(**_loads(agent.model_override_json, {})),
        routing=RoutingConfig(**_loads(agent.routing_json, {"fixed_replies": []})),
        context_config=ContextConfig(**_loads(agent.context_config_json, {"max_rounds": 20})),
        max_iterations=agent.max_iterations,
        status=agent.status,
        version=agent.version,
        published_at=agent.published_at,
        current_spec_hash=current_spec_hash,
        latest_release_spec_hash=latest_release_spec_hash,
        config_pending_publish=config_pending_publish,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


def agent_from_create(agent_id: str, payload: AgentCreate, org_id: str = "org_default") -> Agent:
    return Agent(
        id=agent_id,
        org_id=org_id,
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
        system_prompt=payload.system_prompt,
        llm_config_id=payload.llm_config_id,
        model=payload.model,
        engine_mode=payload.engine_mode,
        tools_json=_dumps(payload.tools),
        skills_json=_dumps(payload.skills),
        subagents_json=_dumps(payload.subagents),
        memory_json=_dumps(payload.memory),
        filesystem_json=_dumps(payload.filesystem),
        permissions_json=_dumps(payload.permissions),
        runtime_json=_dumps(payload.runtime),
        output_json=_dumps(payload.output),
        harness_json=_dumps(payload.harness),
        metadata_json=_dumps(payload.metadata),
        model_override_json=_dumps(payload.model_override),
        routing_json=_dumps(payload.routing),
        context_config_json=_dumps(payload.context_config),
        max_iterations=payload.max_iterations,
        status="unpublished",
    )
