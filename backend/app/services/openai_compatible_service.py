import json
from time import time
from typing import Any, AsyncGenerator, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.core.models import Agent, new_id
from app.core.schemas import AgentInvocationRequest, CanonicalMessage
from app.services.agent_execution_service import AgentExecutionService


class ResponsesRequest(BaseModel):
    model: str
    input: str | list[dict[str, Any]]
    stream: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatCompletionMessage(BaseModel):
    role: str
    content: str | list[dict[str, Any]] | None = ""


class ChatCompletionsRequest(BaseModel):
    model: str
    messages: list[ChatCompletionMessage]
    stream: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentExecutionRequest(BaseModel):
    agent_id: str
    model_ref: str
    input_text: str
    messages: list[CanonicalMessage] = Field(default_factory=list)
    conversation_id: str | None = None
    execution_context_id: str | None = None
    stream: bool = False
    preview: bool = False
    entrypoint: str = "responses"
    run_source: str = "runtime"
    trace_label: str = "执行引擎启动"
    done_label: str = "运行完成"
    error_label: str = "运行失败"
    rerun_of_run_id: str | None = None
    persist_messages: bool = True
    runtime_plan_override: Any = None


def resolve_agent_id(session: Session, org_id: str, model: str) -> str:
    agent_key = model.strip()
    if not agent_key.startswith("agent:"):
        raise HTTPException(status_code=422, detail="model 必须使用 agent:<service_slug> 或 agent:<agent_id>")
    agent_key = agent_key.removeprefix("agent:").strip()
    if not agent_key:
        raise HTTPException(status_code=422, detail="model 必须使用 agent:<service_slug> 或 agent:<agent_id>")

    agent = session.get(Agent, agent_key)
    if agent and agent.org_id == org_id:
        return agent.id

    slug_agent = session.exec(
        select(Agent).where(Agent.org_id == org_id, Agent.slug == agent_key).order_by(Agent.updated_at.desc())
    ).first()
    if slug_agent:
        return slug_agent.id

    raise HTTPException(status_code=404, detail="model 未映射到可运行服务")


def responses_to_execution(session: Session, org_id: str, payload: ResponsesRequest) -> AgentExecutionRequest:
    metadata = payload.metadata or {}
    messages = _responses_input_to_messages(payload.input)
    return AgentExecutionRequest(
        agent_id=resolve_agent_id(session, org_id, payload.model),
        model_ref=payload.model,
        input_text=_last_user_text(messages),
        messages=messages,
        conversation_id=_optional_text(metadata.get("conversation_id")),
        stream=payload.stream,
        preview=_preview_requested(metadata),
        entrypoint="responses",
    )


def chat_completions_to_execution(
    session: Session,
    org_id: str,
    payload: ChatCompletionsRequest,
) -> AgentExecutionRequest:
    metadata = payload.metadata or {}
    messages = _chat_messages_to_canonical(payload.messages)
    return AgentExecutionRequest(
        agent_id=resolve_agent_id(session, org_id, payload.model),
        model_ref=payload.model,
        input_text=_last_user_text(messages),
        messages=messages,
        conversation_id=_optional_text(metadata.get("conversation_id")),
        stream=payload.stream,
        preview=_preview_requested(metadata),
        entrypoint="chat_completions",
    )


def _preview_requested(metadata: dict[str, Any]) -> bool:
    if "preview" not in metadata:
        return False
    value = metadata.get("preview")
    if isinstance(value, bool):
        return value
    raise HTTPException(status_code=422, detail="metadata.preview 仅支持布尔 true/false")


async def run_agent_once(service: AgentExecutionService, request: AgentExecutionRequest) -> dict[str, Any]:
    output = ""
    conversation_id = request.conversation_id
    run_id = ""
    async for event in _stream_internal_events(service, request):
        event_type = event.get("type")
        if event_type == "meta":
            conversation_id = str(event.get("conversation_id") or conversation_id or "")
            run_id = str(event.get("run_id") or run_id or "")
        elif event_type == "output_delta":
            output += str(event.get("content") or "")
        elif event_type == "error":
            message = str(event.get("message") or "服务执行失败")
            raise HTTPException(status_code=_status_code_for_execution_error(message), detail=message)
    return {"output_text": output, "conversation_id": conversation_id, "run_id": run_id}


def _status_code_for_execution_error(message: str) -> int:
    if "不存在" in message or "未上线" in message or "尚未生成上线版本" in message:
        return 400
    if (
        "运行检查" in message
        or "运行依赖不可用" in message
        or "运行清单存在阻断风险" in message
        or "运行被阻断" in message
        or "运行治理门" in message
        or "一致性校验失败" in message
        or "密钥未配置" in message
    ):
        return 400
    if "权限" in message:
        return 403
    return 500


async def stream_responses_events(
    service: AgentExecutionService,
    request: AgentExecutionRequest,
) -> AsyncGenerator[str, None]:
    response_id = new_id("resp")
    created_at = int(time())
    conversation_id = request.conversation_id or ""
    run_id = ""
    output_index = 0
    yield _sse(
        "response.created",
        {
            "type": "response.created",
            "response": _response_envelope(
                response_id=response_id,
                status="in_progress",
                created_at=created_at,
                model=request.model_ref,
                conversation_id=conversation_id,
                run_id=run_id,
            ),
        },
    )

    async for event in _stream_internal_events(service, request):
        event_type = event.get("type")
        if event_type == "meta":
            conversation_id = str(event.get("conversation_id") or conversation_id)
            run_id = str(event.get("run_id") or run_id)
            yield _sse(
                "response.in_progress",
                {
                    "type": "response.in_progress",
                    "response": _response_envelope(
                        response_id=response_id,
                        status="in_progress",
                        created_at=created_at,
                        model=request.model_ref,
                        conversation_id=conversation_id,
                        run_id=run_id,
                    ),
                },
            )
        elif event_type == "output_delta":
            yield _sse(
                "response.output_text.delta",
                {
                    "type": "response.output_text.delta",
                    "response_id": response_id,
                    "item_id": run_id or response_id,
                    "output_index": output_index,
                    "content_index": 0,
                    "delta": str(event.get("content") or ""),
                    "metadata": _metadata(conversation_id=conversation_id, run_id=run_id),
                },
            )
        elif event_type == "completed":
            yield _sse(
                "response.completed",
                {
                    "type": "response.completed",
                    "response": _response_envelope(
                        response_id=response_id,
                        status="completed",
                        created_at=created_at,
                        model=request.model_ref,
                        conversation_id=conversation_id,
                        run_id=run_id,
                    ),
                },
            )
        elif event_type == "error":
            yield _sse(
                "response.failed",
                {
                    "type": "response.failed",
                    "response": _response_envelope(
                        response_id=response_id,
                        status="failed",
                        created_at=created_at,
                        model=request.model_ref,
                        conversation_id=conversation_id,
                        run_id=run_id,
                        error={"message": str(event.get("message") or "服务执行失败")},
                    ),
                },
            )

    yield "data: [DONE]\n\n"


async def stream_chat_completion_events(
    service: AgentExecutionService,
    request: AgentExecutionRequest,
) -> AsyncGenerator[str, None]:
    completion_id = new_id("chatcmpl")
    created_at = int(time())
    conversation_id = request.conversation_id or ""
    run_id = ""
    async for event in _stream_internal_events(service, request):
        event_type = event.get("type")
        if event_type == "meta":
            conversation_id = str(event.get("conversation_id") or conversation_id)
            run_id = str(event.get("run_id") or run_id)
        elif event_type == "output_delta":
            yield _sse(
                "chat.completion.chunk",
                {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created_at,
                    "model": request.model_ref,
                    "choices": [{"index": 0, "delta": {"content": str(event.get("content") or "")}, "finish_reason": None}],
                    "metadata": _metadata(conversation_id=conversation_id, run_id=run_id),
                },
            )
        elif event_type == "completed":
            yield _sse(
                "chat.completion.chunk",
                {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created_at,
                    "model": request.model_ref,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                    "metadata": _metadata(conversation_id=conversation_id, run_id=run_id),
                },
            )
        elif event_type == "error":
            yield _sse(
                "error",
                {
                    "error": {
                        "message": str(event.get("message") or "服务执行失败"),
                        "type": "service_execution_error",
                    },
                    "metadata": _metadata(conversation_id=conversation_id, run_id=run_id),
                },
            )
    yield "data: [DONE]\n\n"


async def _stream_internal_events(
    service: AgentExecutionService,
    request: AgentExecutionRequest,
) -> AsyncGenerator[dict[str, Any], None]:
    payload = AgentInvocationRequest(
        message=request.input_text,
        messages=request.messages,
        conversation_id=request.conversation_id,
        execution_context_id=request.execution_context_id,
        attachment_ids=[],
        preview=request.preview,
        entrypoint=request.entrypoint,
        run_source=request.run_source,
        trace_label=request.trace_label,
        done_label=request.done_label,
        error_label=request.error_label,
        rerun_of_run_id=request.rerun_of_run_id,
        persist_messages=request.persist_messages,
        runtime_plan_override=request.runtime_plan_override,
    )
    async for event in service.stream_events(request.agent_id, payload):
        yield event


def _responses_input_to_messages(value: str | list[dict[str, Any]]) -> list[CanonicalMessage]:
    if isinstance(value, str):
        return [CanonicalMessage(role="user", content=value)]
    messages: list[CanonicalMessage] = []
    for item in value:
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="input 数组项必须是对象")
        role = _canonical_role(item.get("role"))
        content = _content_to_text(item.get("content"))
        if content:
            messages.append(CanonicalMessage(role=role, content=content))
    if not messages:
        raise HTTPException(status_code=422, detail="input 至少需要一条可执行消息")
    _last_user_text(messages)
    return messages


def _chat_messages_to_canonical(value: list[ChatCompletionMessage]) -> list[CanonicalMessage]:
    messages: list[CanonicalMessage] = []
    for item in value:
        role = _canonical_role(item.role)
        content = _content_to_text(item.content)
        if content:
            messages.append(CanonicalMessage(role=role, content=content))
    if not messages:
        raise HTTPException(status_code=422, detail="messages 至少需要一条可执行消息")
    _last_user_text(messages)
    return messages


def _canonical_role(value: Any) -> Literal["system", "developer", "user", "assistant"]:
    role = str(value or "").strip().lower()
    if role in {"system", "developer", "user", "assistant"}:
        return role  # type: ignore[return-value]
    raise HTTPException(status_code=422, detail=f"不支持的消息角色: {role or '-'}")


def _last_user_text(messages: list[CanonicalMessage]) -> str:
    for item in reversed(messages):
        if item.role == "user":
            return item.content
    raise HTTPException(status_code=422, detail="messages 至少需要一条 user 消息")


def _content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                raise HTTPException(status_code=422, detail="消息 content 数组项必须是对象")
            item_type = item.get("type")
            if item_type in {"input_text", "text"}:
                parts.append(str(item.get("text") or ""))
            else:
                raise HTTPException(status_code=422, detail=f"暂不支持的消息内容类型: {item_type or '-'}")
        return "\n".join(part for part in parts if part)
    return str(content)


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _response_envelope(
    *,
    response_id: str,
    status: Literal["in_progress", "completed", "failed"],
    created_at: int,
    model: str,
    conversation_id: str,
    run_id: str,
    error: str = "",
) -> dict[str, Any]:
    envelope = {
        "id": response_id,
        "object": "response",
        "created_at": created_at,
        "status": status,
        "model": model,
        "metadata": _metadata(conversation_id=conversation_id, run_id=run_id),
    }
    if error:
        envelope["error"] = {"message": error, "type": "service_execution_error"}
    return envelope


def _metadata(*, conversation_id: str, run_id: str) -> dict[str, str]:
    metadata: dict[str, str] = {}
    if conversation_id:
        metadata["conversation_id"] = conversation_id
    if run_id:
        metadata["run_id"] = run_id
    return metadata


def _sse(event_type: str, data: dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
