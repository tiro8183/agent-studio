from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import AuthContext, get_current_context, require_role
from app.core.models import Conversation, Message
from app.core.schemas import ConversationRead, MessageRead
from app.db.session import get_session
from app.services.conversation_lifecycle_service import delete_conversation_resources
from app.services.tenant_scope import get_agent_or_404, get_conversation_or_404

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("", response_model=List[ConversationRead])
def list_sessions(
    agent_id: Optional[str] = None,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[ConversationRead]:
    stmt = select(Conversation).where(Conversation.org_id == context.organization.id).order_by(Conversation.updated_at.desc())
    if agent_id:
        get_agent_or_404(session, agent_id, context.organization.id)
        stmt = stmt.where(Conversation.agent_id == agent_id)
    return list(session.exec(stmt).all())


@router.get("/{conversation_id}/messages", response_model=List[MessageRead])
def list_messages(
    conversation_id: str,
    context: AuthContext = Depends(get_current_context),
    session: Session = Depends(get_session),
) -> List[MessageRead]:
    get_conversation_or_404(session, conversation_id, context.organization.id)
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id, Message.org_id == context.organization.id)
        .order_by(Message.created_at)
    )
    return list(session.exec(stmt).all())


@router.delete("/{conversation_id}")
def delete_session(
    conversation_id: str,
    context: AuthContext = Depends(require_role("editor")),
    session: Session = Depends(get_session),
) -> Dict[str, str]:
    conversation = get_conversation_or_404(session, conversation_id, context.organization.id)
    delete_conversation_resources(session, conversation)
    return {"status": "deleted"}
