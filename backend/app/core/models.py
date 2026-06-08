from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import CheckConstraint, Column, Index, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:16]}"


def TextField(default=..., **kwargs):
    kwargs.setdefault("nullable", False)
    return Field(default=default, sa_column=Column(Text, **kwargs))


def OptionalTextField(default=None, **kwargs):
    return Field(default=default, sa_column=Column(Text, nullable=True, **kwargs))


class LLMConfig(SQLModel, table=True):
    __tablename__ = "llm_configs"

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    name: str
    provider_type: str = "custom"
    api_key: str = ""
    base_url: Optional[str] = None
    available_models_json: str = "[]"
    default_model: str
    temperature: float = 0.7
    max_tokens: int = 4096
    extra_headers_json: str = "{}"
    status: str = "active"
    last_check_status: str = TextField("unchecked")
    last_check_message: str = TextField("")
    last_checked_at: Optional[str] = OptionalTextField()
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(primary_key=True)
    email: str = Field(index=True, unique=True)
    display_name: str
    password_hash: str
    status: str = "active"
    last_login_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class Organization(SQLModel, table=True):
    __tablename__ = "organizations"

    id: str = Field(primary_key=True)
    name: str
    slug: str = Field(index=True, unique=True)
    status: str = "active"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class OrganizationMember(SQLModel, table=True):
    __tablename__ = "organization_members"

    id: str = Field(primary_key=True)
    org_id: str = Field(index=True)
    user_id: str = Field(index=True)
    role: str = "owner"
    status: str = "active"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class ApiToken(SQLModel, table=True):
    __tablename__ = "api_tokens"

    id: str = Field(primary_key=True)
    token_hash: str = Field(index=True, unique=True)
    user_id: str = Field(index=True)
    org_id: str = Field(index=True)
    token_type: str = Field(default="personal_api_token", index=True)
    name: str
    status: str = "active"
    expires_at: Optional[str] = None
    last_used_at: Optional[str] = None
    revoked_at: Optional[str] = None
    revoked_by: Optional[str] = Field(default=None, index=True)
    created_at: str = Field(default_factory=now_iso)


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"

    id: str = Field(default_factory=lambda: new_id("audit"), primary_key=True)
    org_id: Optional[str] = Field(default=None, index=True)
    user_id: Optional[str] = Field(default=None, index=True)
    action: str = Field(index=True)
    resource_type: str = ""
    resource_id: str = ""
    status: str = "success"
    ip: str = ""
    user_agent: str = ""
    metadata_json: str = "{}"
    created_at: str = Field(default_factory=now_iso)


class Agent(SQLModel, table=True):
    __tablename__ = "agents"
    __table_args__ = (
        Index("ix_agents_org_id_slug", "org_id", "slug", unique=True),
        CheckConstraint(
            "status IN ('unpublished', 'published', 'inactive')",
            name="ck_agents_status_lifecycle",
        ),
    )

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    name: str
    slug: str = Field(default="", index=True)
    description: str = ""
    system_prompt: str = "按既定业务口径处理输入，输出可复核、可执行的结论。"
    llm_config_id: str
    model: str
    engine_mode: str = "deepagents"
    tools_json: str = TextField("[]")
    skills_json: str = TextField("[]")
    subagents_json: str = TextField("[]")
    memory_json: str = TextField("[]")
    filesystem_json: str = TextField('{"enabled":true,"mode":"state","read_only":false}')
    permissions_json: str = TextField('{"allow_write":true,"allowed_paths":["/workspace/**","/skills/**"]}')
    runtime_json: str = TextField('{"backend_type":"filesystem","debug":false,"checkpointing":false,"interrupt_on":{}}')
    output_json: str = TextField('{"mode":"text","json_schema":{}}')
    harness_json: str = TextField('{"excluded_tools":[],"tool_description_overrides":{},"disable_general_purpose_subagent":false}')
    metadata_json: str = TextField("{}")
    model_override_json: str = "{}"
    routing_json: str = '{"fixed_replies":[]}'
    context_config_json: str = '{"max_rounds":20}'
    max_iterations: int = 8
    status: str = "unpublished"
    version: int = 1
    published_at: Optional[str] = OptionalTextField()
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class AgentReleaseSnapshot(SQLModel, table=True):
    __tablename__ = "agent_release_snapshots"
    __table_args__ = (
        UniqueConstraint("agent_id", "version", name="uq_agent_release_snapshots_agent_version"),
        CheckConstraint("status = 'published'", name="ck_agent_release_snapshots_status_published"),
    )

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str = Field(index=True)
    version: int = Field(index=True)
    status: str = "published"
    agent_spec_json: str = TextField()
    runtime_spec_json: str = TextField()
    runtime_manifest_json: str = TextField("{}")
    spec_hash: str = Field(index=True)
    manifest_hash: str = Field(default="", index=True)
    created_at: str = Field(default_factory=now_iso)


class Conversation(SQLModel, table=True):
    __tablename__ = "conversations"

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str
    title: str = "新会话"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class Message(SQLModel, table=True):
    __tablename__ = "messages"

    id: str = Field(default_factory=lambda: new_id("msg"), primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    conversation_id: str = Field(index=True)
    role: str
    content: str
    created_at: str = Field(default_factory=now_iso)


class AgentRun(SQLModel, table=True):
    __tablename__ = "agent_runs"
    __table_args__ = (
        Index("ix_agent_runs_total_tokens", "total_tokens"),
    )

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str = Field(index=True)
    conversation_id: str = Field(index=True)
    rerun_of_run_id: Optional[str] = Field(default=None, index=True)
    release_id: Optional[str] = Field(default=None, index=True)
    agent_version: int = 1
    spec_hash: str = Field(default="", index=True)
    runtime_source: str = Field(default="release", index=True)
    entrypoint: str = Field(default="responses", index=True)
    run_source: str = Field(default="runtime", index=True)
    status: str = "running"
    model: str
    tools_json: str = "[]"
    input_preview: str = ""
    input_text: str = TextField("")
    output_preview: str = ""
    output_text: str = TextField("")
    error: str = ""
    duration_ms: int = 0
    first_token_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    llm_calls: int = 0
    subagents_json: str = TextField("[]")
    runtime_spec_json: str = TextField("{}")
    runtime_manifest_json: str = TextField("{}")
    knowledge_count: int = 0
    started_at: str = Field(default_factory=now_iso)
    ended_at: Optional[str] = None


class RunEvent(SQLModel, table=True):
    __tablename__ = "run_events"
    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_run_events_run_seq"),
        Index("ix_run_events_org_run_seq", "org_id", "run_id", "seq"),
        Index("ix_run_events_org_agent_created", "org_id", "agent_id", "created_at"),
        Index("ix_run_events_org_type_created", "org_id", "type", "created_at"),
    )

    id: str = Field(default_factory=lambda: new_id("evt"), primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str = Field(index=True)
    run_id: str = Field(index=True)
    seq: int = Field(index=True)
    step_id: str = Field(default="", index=True)
    parent_seq: Optional[int] = None
    phase: str = Field(default="reasoning", index=True)
    type: str = Field(default="event", index=True)
    label: str = TextField("")
    status: str = Field(default="info", index=True)
    timestamp: str = ""
    elapsed_ms: int = 0
    duration_ms: int = 0
    resource: Optional[str] = Field(default=None, index=True)
    call_id: Optional[str] = Field(default=None, index=True)
    subagent: Optional[str] = Field(default=None, index=True)
    task: Optional[str] = OptionalTextField()
    input_preview: str = TextField("")
    output_preview: str = TextField("")
    metadata_json: str = TextField("{}")
    input_json: str = TextField("null")
    output_json: str = TextField("null")
    created_at: str = Field(default_factory=now_iso)


class LLMInvocationLog(SQLModel, table=True):
    __tablename__ = "llm_invocation_logs"
    __table_args__ = (
        Index("ix_llm_invocation_logs_org_run_created_at", "org_id", "run_id", "created_at"),
        Index("ix_llm_invocation_logs_org_agent_created_at", "org_id", "agent_id", "created_at"),
        Index("ix_llm_invocation_logs_org_provider_created_at", "org_id", "provider_type", "created_at"),
        Index("ix_llm_invocation_logs_org_scope_created_at", "org_id", "runtime_scope", "created_at"),
    )

    id: str = Field(default_factory=lambda: new_id("llmlog"), primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str = Field(index=True)
    run_id: str = Field(index=True)
    conversation_id: str = Field(index=True)
    llm_config_id: str = Field(index=True)
    provider_type: str = Field(default="", index=True)
    model: str = Field(default="", index=True)
    runtime_scope: str = Field(default="main", index=True)
    subagent_name: str = Field(default="", index=True)
    source: str = Field(default="runtime", index=True)
    status: str = Field(default="success", index=True)
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    llm_calls: int = 0
    duration_ms: int = 0
    first_token_ms: int = 0
    error: str = ""
    created_at: str = Field(default_factory=now_iso)


class AgentTestCase(SQLModel, table=True):
    __tablename__ = "agent_test_cases"
    __table_args__ = (
        Index("ix_agent_test_cases_org_agent_status_created", "org_id", "agent_id", "status", "created_at"),
    )

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str = Field(index=True)
    name: str
    input_text: str
    expected_keywords_json: str = "[]"
    assertion_json: str = TextField("{}")
    status: str = "active"
    last_status: str = "untested"
    last_output: str = ""
    last_error: str = ""
    last_run_id: Optional[str] = Field(default=None, index=True)
    last_runtime_plan_hash: str = Field(default="", index=True)
    last_run_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class AgentTestSuiteRun(SQLModel, table=True):
    __tablename__ = "agent_test_suite_runs"
    __table_args__ = (
        Index("ix_agent_test_suite_runs_org_agent_started", "org_id", "agent_id", "started_at", "id"),
    )

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str = Field(index=True)
    runtime_plan_hash: str = Field(default="", index=True)
    status: str = "running"
    total: int = 0
    passed: int = 0
    failed: int = 0
    duration_ms: int = 0
    started_at: str = Field(default_factory=now_iso)
    ended_at: Optional[str] = None


class AgentTestRun(SQLModel, table=True):
    __tablename__ = "agent_test_runs"
    __table_args__ = (
        Index("ix_agent_test_runs_org_agent_case_started", "org_id", "agent_id", "case_id", "started_at", "id"),
        Index("ix_agent_test_runs_org_agent_status_case_started", "org_id", "agent_id", "status", "case_id", "started_at", "id"),
        Index(
            "ix_agent_test_runs_org_agent_hash_case_started",
            "org_id",
            "agent_id",
            "runtime_plan_hash",
            "case_id",
            "started_at",
            "id",
        ),
    )

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str = Field(index=True)
    case_id: str = Field(index=True)
    suite_run_id: Optional[str] = Field(default=None, index=True)
    agent_run_id: Optional[str] = Field(default=None, index=True)
    conversation_id: str = Field(default="", index=True)
    runtime_plan_hash: str = Field(default="", index=True)
    case_name: str
    input_text: str = TextField()
    expected_keywords_json: str = TextField("[]")
    assertion_json: str = TextField("{}")
    status: str = "running"
    output: str = TextField("")
    error: str = TextField("")
    assertion_errors_json: str = TextField("[]")
    duration_ms: int = 0
    started_at: str = Field(default_factory=now_iso)
    ended_at: Optional[str] = None


class Upload(SQLModel, table=True):
    __tablename__ = "uploads"

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    conversation_id: Optional[str] = Field(default=None, index=True)
    file_name: str
    file_path: str
    content_type: Optional[str] = None
    size: int = 0
    created_at: str = Field(default_factory=now_iso)


class KnowledgeDocument(SQLModel, table=True):
    __tablename__ = "knowledge_documents"

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str = Field(index=True)
    file_name: str
    file_path: str
    content_type: Optional[str] = None
    size: int = 0
    char_count: int = 0
    preview: str = TextField("")
    status: str = "ready"
    created_at: str = Field(default_factory=now_iso)


class KnowledgeChunkRecord(SQLModel, table=True):
    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        Index("ix_knowledge_chunks_org_agent", "org_id", "agent_id"),
        Index("ix_knowledge_chunks_org_document_ordinal", "org_id", "document_id", "ordinal"),
        Index("ix_knowledge_chunks_org_agent_content_hash", "org_id", "agent_id", "content_hash"),
    )

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str = Field(index=True)
    document_id: str = Field(index=True)
    file_name: str
    ordinal: int = 0
    text: str
    char_count: int = 0
    content_hash: str = Field(default="", index=True)
    chunk_hash: str = Field(default="", index=True)
    embedding_status: str = Field(default="not_configured", index=True)
    embedding_model: Optional[str] = None
    vector_ref: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class KnowledgeRetrievalAudit(SQLModel, table=True):
    __tablename__ = "knowledge_retrieval_audits"
    __table_args__ = (
        Index("ix_knowledge_retrieval_audits_org_run_created_at", "org_id", "run_id", "created_at"),
        Index("ix_knowledge_retrieval_audits_org_agent_created_at", "org_id", "agent_id", "created_at"),
        Index("ix_knowledge_retrieval_audits_org_conversation_created_at", "org_id", "conversation_id", "created_at"),
    )

    id: str = Field(default_factory=lambda: new_id("kraudit"), primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    agent_id: str = Field(index=True)
    run_id: str = Field(index=True)
    conversation_id: str = Field(index=True)
    source: str = Field(default="runtime", index=True)
    query_preview: str = ""
    index_source: str = Field(default="", index=True)
    indexed_chunks: int = 0
    retrieved_chunks: int = 0
    terms_json: str = "[]"
    chunk_refs_json: str = "[]"
    created_at: str = Field(default_factory=now_iso)


class Skill(SQLModel, table=True):
    __tablename__ = "skills"

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    name: str = Field(index=True)
    display_name: str
    description: str
    instructions: str
    allowed_tools_json: str = "[]"
    metadata_json: str = "{}"
    version: int = 1
    status: str = "active"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class SkillVersion(SQLModel, table=True):
    __tablename__ = "skill_versions"

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    skill_id: str = Field(index=True)
    version: int = Field(index=True)
    name: str = Field(index=True)
    display_name: str
    description: str
    instructions: str
    allowed_tools_json: str = "[]"
    metadata_json: str = "{}"
    status: str = "active"
    created_at: str = Field(default_factory=now_iso)


class ToolDefinition(SQLModel, table=True):
    __tablename__ = "tool_definitions"

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    name: str
    description: str = ""
    category: str = "custom"
    implementation: str = "builtin"
    status: str = "active"
    metadata_json: str = "{}"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class ToolSecret(SQLModel, table=True):
    __tablename__ = "tool_secrets"

    id: str = Field(primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    name: str
    value: str
    description: str = ""
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class ToolInvocationAudit(SQLModel, table=True):
    __tablename__ = "tool_invocation_audits"
    __table_args__ = (
        Index("ix_tool_invocation_audits_org_run_created_at", "org_id", "run_id", "created_at"),
        Index("ix_tool_invocation_audits_org_conversation_created_at", "org_id", "conversation_id", "created_at"),
    )

    id: str = Field(default_factory=lambda: new_id("audit"), primary_key=True)
    org_id: str = Field(default="org_default", index=True)
    user_id: Optional[str] = Field(default=None, index=True)
    actor_role: str = ""
    source: str = "manual"
    agent_id: Optional[str] = Field(default=None, index=True)
    run_id: Optional[str] = Field(default=None, index=True)
    conversation_id: Optional[str] = Field(default=None, index=True)
    call_id: Optional[str] = Field(default=None, index=True)
    tool_id: str = Field(index=True)
    implementation: str
    status: str
    method: str = ""
    url: str = ""
    request_preview: str = ""
    response_preview: str = ""
    error: str = ""
    duration_ms: int = 0
    created_at: str = Field(default_factory=now_iso)
