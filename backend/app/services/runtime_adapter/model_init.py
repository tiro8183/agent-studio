from typing import Any

from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage

from app.core.models import LLMConfig
from app.services.llm_provider_policy import normalize_provider_type
from app.services.mappers import _loads
from app.services.secret_codec import decrypt_secret


def model_name(provider_type: str, model: str) -> str:
    provider_type = normalize_provider_type(provider_type)
    if ":" in model:
        return model
    if provider_type == "anthropic":
        return f"anthropic:{model}"
    if provider_type == "google":
        return f"google_genai:{model}"
    return f"openai:{model}"


def build_chat_model_from_contract(contract: dict[str, Any], *, api_key: str = ""):
    kwargs: dict[str, Any] = {
        "api_key": decrypt_secret(api_key) or None,
        "temperature": contract.get("temperature"),
        "max_tokens": contract.get("max_tokens"),
        "top_p": contract.get("top_p"),
    }
    if contract.get("base_url"):
        kwargs["base_url"] = contract.get("base_url")
    default_headers = contract.get("default_headers") or {}
    if default_headers:
        kwargs["default_headers"] = default_headers

    return init_chat_model(
        model_name(str(contract.get("provider_type") or "openai"), str(contract.get("model") or "")),
        **{key: value for key, value in kwargs.items() if value is not None},
    )


def build_probe_chat_model(llm: LLMConfig):
    kwargs: dict[str, Any] = {
        "api_key": decrypt_secret(llm.api_key) or None,
        "temperature": 0,
        "max_tokens": min(llm.max_tokens or 256, 256),
    }
    if llm.base_url:
        kwargs["base_url"] = llm.base_url
    extra_headers = _loads(llm.extra_headers_json, {})
    if extra_headers:
        kwargs["default_headers"] = extra_headers
    return init_chat_model(
        model_name(llm.provider_type, llm.default_model),
        **{key: value for key, value in kwargs.items() if value is not None},
    )


async def probe_chat_model(llm: LLMConfig, prompt: str = "ping") -> str:
    model = build_probe_chat_model(llm)
    response = await model.ainvoke([HumanMessage(content=prompt)])
    return str(getattr(response, "content", "") or "")
