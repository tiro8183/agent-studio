from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.deps import AuthContext, ROLE_RANK, get_current_context
from app.core.models import new_id
from app.db.session import get_session
from app.services.agent_execution_service import AgentExecutionService
from app.services.openai_compatible_service import (
    ChatCompletionsRequest,
    ResponsesRequest,
    chat_completions_to_execution,
    responses_to_execution,
    run_agent_once,
    stream_chat_completion_events,
    stream_responses_events,
)

router = APIRouter(tags=["openai-compatible"])


@router.post("/responses")
async def create_response(
    payload: ResponsesRequest,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> Any:
    request = responses_to_execution(session, context.organization.id, payload)
    _ensure_execution_allowed(context, request.preview, allow_preview=False)
    service = _agent_execution_service(session, context)
    if payload.stream:
        return StreamingResponse(
            stream_responses_events(service, request),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    result = await run_agent_once(service, request)
    return {
        "id": new_id("resp"),
        "object": "response",
        "status": "completed",
        "model": request.model_ref,
        "output_text": str(result.get("output_text") or ""),
        "metadata": {
            "conversation_id": str(result.get("conversation_id") or ""),
            "run_id": str(result.get("run_id") or ""),
        },
    }


@router.post("/chat/completions")
async def create_chat_completion(
    payload: ChatCompletionsRequest,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> Any:
    request = chat_completions_to_execution(session, context.organization.id, payload)
    _ensure_execution_allowed(context, request.preview, allow_preview=False)
    service = _agent_execution_service(session, context)
    if payload.stream:
        return StreamingResponse(
            stream_chat_completion_events(service, request),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    result = await run_agent_once(service, request)
    return {
        "id": new_id("chatcmpl"),
        "object": "chat.completion",
        "model": request.model_ref,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": str(result.get("output_text") or "")},
                "finish_reason": "stop",
            }
        ],
        "metadata": {
            "conversation_id": str(result.get("conversation_id") or ""),
            "run_id": str(result.get("run_id") or ""),
        },
    }


def _ensure_execution_allowed(context: AuthContext, preview: bool, *, allow_preview: bool) -> None:
    role_rank = ROLE_RANK.get(context.membership.role, 0)
    if preview:
        if not allow_preview:
            raise HTTPException(status_code=403, detail="历史兼容入口不支持当前配置验证，请使用标准执行入口")
        if context.token.token_type != "web_session":
            raise HTTPException(status_code=403, detail="当前配置验证仅允许 Studio 登录会话")
        if role_rank < ROLE_RANK["editor"]:
            raise HTTPException(status_code=403, detail="当前配置验证需要编辑权限")
    if role_rank < ROLE_RANK["viewer"]:
        raise HTTPException(status_code=403, detail="权限不足")


def _agent_execution_service(session: Session, context: AuthContext) -> AgentExecutionService:
    return AgentExecutionService(
        session,
        org_id=context.organization.id,
        actor_role=context.membership.role,
        actor_user_id=context.user.id,
    )
