from typing import TypeVar

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, select

from app.core.models import (
    Agent,
    AgentReleaseSnapshot,
    AgentRun,
    AgentTestCase,
    Conversation,
    KnowledgeDocument,
    LLMConfig,
    Skill,
    SkillVersion,
    ToolDefinition,
    ToolInvocationAudit,
    ToolSecret,
    Upload,
)

T = TypeVar("T", bound=SQLModel)


def scoped_stmt(model: type[T], org_id: str):
    return select(model).where(model.org_id == org_id)


def get_or_404(session: Session, model: type[T], row_id: str, org_id: str, detail: str) -> T:
    row = session.get(model, row_id)
    if not row or getattr(row, "org_id", None) != org_id:
        raise HTTPException(status_code=404, detail=detail)
    return row


def get_llm_or_404(session: Session, config_id: str, org_id: str) -> LLMConfig:
    return get_or_404(session, LLMConfig, config_id, org_id, "LLM 配置不存在")


def get_agent_or_404(session: Session, agent_id: str, org_id: str) -> Agent:
    return get_or_404(session, Agent, agent_id, org_id, "服务不存在")


def get_release_or_404(session: Session, release_id: str, org_id: str) -> AgentReleaseSnapshot:
    return get_or_404(session, AgentReleaseSnapshot, release_id, org_id, "上线版本不存在")


def get_conversation_or_404(session: Session, conversation_id: str, org_id: str) -> Conversation:
    return get_or_404(session, Conversation, conversation_id, org_id, "会话不存在")


def get_run_or_404(session: Session, run_id: str, org_id: str) -> AgentRun:
    return get_or_404(session, AgentRun, run_id, org_id, "运行证据不存在")


def get_test_case_or_404(session: Session, case_id: str, org_id: str) -> AgentTestCase:
    return get_or_404(session, AgentTestCase, case_id, org_id, "验收用例不存在")


def get_upload_or_404(session: Session, upload_id: str, org_id: str) -> Upload:
    return get_or_404(session, Upload, upload_id, org_id, "上传文件不存在")


def get_document_or_404(session: Session, document_id: str, org_id: str) -> KnowledgeDocument:
    return get_or_404(session, KnowledgeDocument, document_id, org_id, "业务资料不存在")


def get_skill_or_404(session: Session, skill_id: str, org_id: str) -> Skill:
    return get_or_404(session, Skill, skill_id, org_id, "能力包不存在")


def get_skill_version_or_404(session: Session, version_id: str, org_id: str) -> SkillVersion:
    return get_or_404(session, SkillVersion, version_id, org_id, "能力包版本不存在")


def get_tool_or_404(session: Session, tool_id: str, org_id: str) -> ToolDefinition:
    row = session.get(ToolDefinition, tool_id)
    if not row or (row.implementation != "builtin" and row.org_id != org_id):
        raise HTTPException(status_code=404, detail="工具不存在")
    return row


def get_secret_or_404(session: Session, secret_id: str, org_id: str) -> ToolSecret:
    return get_or_404(session, ToolSecret, secret_id, org_id, "密钥不存在")


def visible_tool_filter(org_id: str):
    return (ToolDefinition.org_id == org_id) | (ToolDefinition.implementation == "builtin")


def visible_tool_audit_filter(org_id: str):
    return ToolInvocationAudit.org_id == org_id
