from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

AgentLifecycleStatus = Literal["unpublished", "published", "inactive"]


class ModelConfig(BaseModel):
    name: str
    is_reasoning_model: bool = False


class LLMConfigBase(BaseModel):
    name: str
    provider_type: str = Field(default="custom", min_length=1)
    api_key: str = ""
    base_url: Optional[str] = None
    available_models: List[ModelConfig] = Field(default_factory=list)
    default_model: str
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=4096, ge=1)
    extra_headers: Dict[str, str] = Field(default_factory=dict)
    status: Literal["active", "inactive"] = "active"


class LLMConfigCreate(LLMConfigBase):
    id: Optional[str] = None


class LLMConfigUpdate(BaseModel):
    name: Optional[str] = None
    provider_type: Optional[str] = Field(default=None, min_length=1)
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    available_models: Optional[List[ModelConfig]] = None
    default_model: Optional[str] = None
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    max_tokens: Optional[int] = Field(default=None, ge=1)
    extra_headers: Optional[Dict[str, str]] = None
    status: Optional[Literal["active", "inactive"]] = None


class LLMConfigRead(LLMConfigBase):
    id: str
    org_id: str = ""
    api_key: str = ""
    api_key_configured: bool = False
    last_check_status: str = "unchecked"
    last_check_message: str = ""
    last_checked_at: Optional[str] = None
    created_at: str
    updated_at: str


class LLMCheckRead(BaseModel):
    id: str
    status: Literal["healthy", "failed", "unchecked"]
    message: str = ""
    checked_at: str


class UserRead(BaseModel):
    id: str
    email: str
    display_name: str
    status: str
    created_at: str
    updated_at: str
    last_login_at: Optional[str] = None


class OrganizationRead(BaseModel):
    id: str
    name: str
    slug: str
    status: str
    created_at: str
    updated_at: str


class OrganizationMemberRead(BaseModel):
    id: str
    org_id: str
    user_id: str
    role: Literal["owner", "admin", "editor", "viewer"]
    status: str
    created_at: str
    updated_at: str


class OrganizationMemberUserRead(OrganizationMemberRead):
    user_email: str
    user_display_name: str
    user_status: str
    user_last_login_at: Optional[str] = None


class OrganizationMemberCreate(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["owner", "admin", "editor", "viewer"] = "viewer"


class OrganizationMemberPasswordReset(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class OrganizationMemberUpdate(BaseModel):
    role: Optional[Literal["owner", "admin", "editor", "viewer"]] = None
    status: Optional[Literal["active", "disabled"]] = None


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class AuthSessionRead(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: Optional[str] = None
    user: UserRead
    organization: OrganizationRead
    membership: OrganizationMemberRead


class CurrentUserRead(BaseModel):
    user: UserRead
    organization: OrganizationRead
    membership: OrganizationMemberRead


class ApiTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    expires_at: Optional[str] = None


class ApiTokenRead(BaseModel):
    id: str
    name: str
    token_type: str = "personal_api_token"
    status: str
    expires_at: Optional[str] = None
    last_used_at: Optional[str] = None
    revoked_at: Optional[str] = None
    revoked_by: Optional[str] = None
    created_at: str


class ApiTokenCreatedRead(ApiTokenRead):
    token: str


class ApiTokenUserRead(ApiTokenRead):
    user_id: str
    user_email: str
    user_display_name: str
    user_role: Optional[Literal["owner", "admin", "editor", "viewer"]] = None
    user_status: str = ""
    revoked_by_email: str = ""
    revoked_by_display_name: str = ""


class AuditLogRead(BaseModel):
    id: str
    org_id: Optional[str] = None
    user_id: Optional[str] = None
    user_email: str = ""
    action: str
    resource_type: str = ""
    resource_id: str = ""
    status: str
    ip: str = ""
    user_agent: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: str


class PlatformReadinessCheck(BaseModel):
    key: str
    label: str
    ready: bool
    severity: Literal["blocker", "warning", "info"] = "blocker"
    detail: str = ""
    evidence: Dict[str, Any] = Field(default_factory=dict)


class PlatformReadinessRead(BaseModel):
    status: Literal["ready", "degraded", "blocked"]
    environment: str
    checked_at: str
    blockers: int = 0
    warnings: int = 0
    checks: List[PlatformReadinessCheck] = Field(default_factory=list)


class MonitorStatsRead(BaseModel):
    agents: int = 0
    published_agents: int = 0
    llm_configs: int = 0
    active_llm_configs: int = 0
    conversations: int = 0
    messages: int = 0
    runs: int = 0
    completed_runs: int = 0
    failed_runs: int = 0
    running_runs: int = 0
    cancelled_runs: int = 0
    stale_runs: int = 0
    success_rate: int = 0
    avg_duration_ms: int = 0
    avg_first_token_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    llm_calls: int = 0
    knowledge_documents: int = 0
    test_cases: int = 0
    passed_test_cases: int = 0
    runtime_state_bytes: int = 0
    checkpoint_bytes: int = 0
    store_bytes: int = 0
    checkpoints: int = 0
    checkpoint_writes: int = 0
    store_items: int = 0


class LLMUsageBreakdownItemRead(BaseModel):
    runtime_scope: str = "main"
    subagent_name: str = ""
    provider_type: str = ""
    model: str = ""
    llm_config_id: str = ""
    llm_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class LLMUsageBreakdownRead(BaseModel):
    total_llm_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    items: List[LLMUsageBreakdownItemRead] = Field(default_factory=list)


class LLMHealthBreakdownItemRead(BaseModel):
    runtime_scope: str = "main"
    subagent_name: str = ""
    provider_type: str = ""
    model: str = ""
    llm_config_id: str = ""
    total_llm_calls: int = 0
    success_llm_calls: int = 0
    failed_llm_calls: int = 0
    success_rate: int = 0
    avg_duration_ms: int = 0
    avg_first_token_ms: int = 0
    total_tokens: int = 0
    last_error: str = ""


class LLMHealthBreakdownRead(BaseModel):
    total_llm_calls: int = 0
    success_llm_calls: int = 0
    failed_llm_calls: int = 0
    success_rate: int = 0
    avg_duration_ms: int = 0
    avg_first_token_ms: int = 0
    items: List[LLMHealthBreakdownItemRead] = Field(default_factory=list)


class RunRetentionPolicyRead(BaseModel):
    retain_days: int = Field(ge=1)
    retain_minimum: int = Field(ge=0)
    include_running: bool = False


class RunRetentionRequest(BaseModel):
    retain_days: Optional[int] = Field(default=None, ge=1)
    retain_minimum: Optional[int] = Field(default=None, ge=0)
    include_running: bool = False


class RunRetentionCandidateRead(BaseModel):
    id: str
    agent_id: str
    status: str
    started_at: str
    ended_at: Optional[str] = None


class RunRetentionRead(BaseModel):
    policy: RunRetentionPolicyRead
    total_runs: int
    eligible_runs: int
    retained_runs: int
    deleted_runs: int
    protected_test_runs: int
    protected_minimum_runs: int
    protected_running_runs: int
    deleted_llm_logs: int = 0
    deleted_tool_audits: int = 0
    deleted_knowledge_audits: int = 0
    deleted_run_events: int = 0
    cleared_rerun_links: int = 0
    cutoff_at: str
    dry_run: bool
    candidate_runs: List[RunRetentionCandidateRead] = Field(default_factory=list)


class RuntimeStateRead(BaseModel):
    backend: Literal["postgres", "sqlite", "memory"]
    state_dir: str
    checkpoint_db: str
    store_db: str
    checkpoint_exists: bool
    store_exists: bool
    status: Literal["healthy", "warning"]
    warnings: List[str] = Field(default_factory=list)
    runtime_state_bytes: int = 0
    checkpoint_bytes: int = 0
    store_bytes: int = 0
    checkpoints: int = 0
    checkpoint_writes: int = 0
    store_items: int = 0
    postgres_package_available: Optional[bool] = None


class UploadQuotaRead(BaseModel):
    max_total_bytes: int
    used_bytes: int
    remaining_bytes: int
    attachment_bytes: int
    knowledge_bytes: int
    usage_percent: int = 0
    upload_max_bytes: int = 0
    knowledge_upload_max_bytes: int = 0
    allowed_extensions: List[str] = Field(default_factory=list)
    allowed_content_types: List[str] = Field(default_factory=list)


class ModelOverride(BaseModel):
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    max_tokens: Optional[int] = Field(default=None, ge=1)
    top_p: Optional[float] = Field(default=None, ge=0, le=1)


class FixedReply(BaseModel):
    keywords: List[str] = Field(default_factory=list)
    reply: str = ""


class RoutingConfig(BaseModel):
    fixed_replies: List[FixedReply] = Field(default_factory=list)


class ContextConfig(BaseModel):
    max_rounds: int = Field(default=20, ge=1, le=100)


class FilesystemConfig(BaseModel):
    enabled: bool = True
    mode: Literal["state", "virtual"] = "virtual"
    read_only: bool = False


class PermissionConfig(BaseModel):
    allow_write: bool = True
    allowed_paths: List[str] = Field(default_factory=lambda: ["/workspace/**", "/skills/**"])


class RuntimeConfig(BaseModel):
    backend_type: Literal["state", "filesystem", "store"] = "filesystem"
    debug: bool = False
    checkpointing: bool = False
    interrupt_on: Dict[str, bool] = Field(default_factory=dict)


class OutputConfig(BaseModel):
    mode: Literal["text", "json_schema"] = "text"
    json_schema: Dict[str, Any] = Field(default_factory=dict)


class HarnessConfig(BaseModel):
    excluded_tools: List[str] = Field(default_factory=list)
    tool_description_overrides: Dict[str, str] = Field(default_factory=dict)
    disable_general_purpose_subagent: bool = False


class SubAgentConfig(BaseModel):
    name: str
    description: str = ""
    system_prompt: str = ""
    llm_config_id: Optional[str] = None
    model: Optional[str] = None
    tools: List[str] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    memory: List[str] = Field(default_factory=list)
    interrupt_on: Dict[str, bool] = Field(default_factory=dict)
    permissions: Optional[PermissionConfig] = None
    output: OutputConfig = Field(default_factory=OutputConfig)


class AgentBase(BaseModel):
    name: str
    slug: str = ""
    description: str = ""
    system_prompt: str = "按既定业务口径处理输入，输出可复核、可执行的结论。"
    llm_config_id: str
    model: str
    engine_mode: Literal["deepagents"] = "deepagents"
    tools: List[str] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    subagents: List[SubAgentConfig] = Field(default_factory=list)
    memory: List[str] = Field(default_factory=list)
    filesystem: FilesystemConfig = Field(default_factory=FilesystemConfig)
    permissions: PermissionConfig = Field(default_factory=PermissionConfig)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)
    harness: HarnessConfig = Field(default_factory=HarnessConfig)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    model_override: ModelOverride = Field(default_factory=ModelOverride)
    routing: RoutingConfig = Field(default_factory=RoutingConfig)
    context_config: ContextConfig = Field(default_factory=ContextConfig)
    max_iterations: int = Field(default=8, ge=1, le=60)


class AgentCreate(AgentBase):
    pass


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    llm_config_id: Optional[str] = None
    model: Optional[str] = None
    engine_mode: Optional[Literal["deepagents"]] = None
    tools: Optional[List[str]] = None
    skills: Optional[List[str]] = None
    subagents: Optional[List[SubAgentConfig]] = None
    memory: Optional[List[str]] = None
    filesystem: Optional[FilesystemConfig] = None
    permissions: Optional[PermissionConfig] = None
    runtime: Optional[RuntimeConfig] = None
    output: Optional[OutputConfig] = None
    harness: Optional[HarnessConfig] = None
    metadata: Optional[Dict[str, Any]] = None
    model_override: Optional[ModelOverride] = None
    routing: Optional[RoutingConfig] = None
    context_config: Optional[ContextConfig] = None
    max_iterations: Optional[int] = Field(default=None, ge=1, le=60)


class AgentRead(AgentBase):
    id: str
    org_id: str = ""
    status: AgentLifecycleStatus = "unpublished"
    version: int = 1
    published_at: Optional[str] = None
    current_spec_hash: str = ""
    latest_release_spec_hash: str = ""
    config_pending_publish: bool = False
    created_at: str
    updated_at: str


class AgentCompletenessItem(BaseModel):
    key: str
    label: str
    passed: bool
    detail: str = ""


class AgentCompletenessRead(BaseModel):
    agent_id: str
    score: int
    can_publish: bool
    items: List[AgentCompletenessItem]


class RuntimeResourceRead(BaseModel):
    id: str
    name: str = ""
    status: str = ""
    kind: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RuntimeKnowledgeManifest(BaseModel):
    id: str
    file_name: str = ""
    content_type: str = ""
    size: int = 0
    snapshot_size: int = 0
    char_count: int = 0
    content_hash: str = ""
    chunk_count: int = 0
    chunk_source: str = ""


class RuntimeModelContract(BaseModel):
    scope: Literal["main", "subagent"] = "main"
    subagent: str = ""
    llm_config_id: str
    provider_type: str = ""
    base_url: Optional[str] = None
    model: str
    default_headers: Dict[str, Any] = Field(default_factory=dict)
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    api_key_ref: str = ""
    status: str = ""


class RuntimeSubAgentManifest(BaseModel):
    name: str
    description: str = ""
    system_prompt: str = ""
    model: str = ""
    llm_config_id: Optional[str] = None
    tools: List[RuntimeResourceRead] = Field(default_factory=list)
    skills: List[RuntimeResourceRead] = Field(default_factory=list)
    memory: List[str] = Field(default_factory=list)
    interrupt_on: Dict[str, bool] = Field(default_factory=dict)
    permissions: PermissionConfig
    output: OutputConfig


class AgentRuntimeManifestRead(BaseModel):
    agent_id: str
    agent_name: str
    engine_mode: Literal["deepagents"] = "deepagents"
    system_prompt: str = ""
    model: str
    llm_config_id: str
    backend_type: Literal["state", "filesystem", "store"]
    checkpointing: bool
    debug: bool
    main_tools: List[RuntimeResourceRead] = Field(default_factory=list)
    main_skills: List[RuntimeResourceRead] = Field(default_factory=list)
    subagents: List[RuntimeSubAgentManifest] = Field(default_factory=list)
    model_contracts: List[RuntimeModelContract] = Field(default_factory=list)
    memory: List[str] = Field(default_factory=list)
    interrupt_on: Dict[str, bool] = Field(default_factory=dict)
    permissions: PermissionConfig
    filesystem: FilesystemConfig
    output: OutputConfig
    harness: HarnessConfig
    knowledge: List[RuntimeKnowledgeManifest] = Field(default_factory=list)
    missing_tools: List[str] = Field(default_factory=list)
    missing_skills: List[str] = Field(default_factory=list)
    inactive_tools: List[str] = Field(default_factory=list)
    inactive_skills: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class AgentRuntimeManifestEnvelopeRead(BaseModel):
    source: Literal["draft", "preview", "release"]
    manifest: AgentRuntimeManifestRead
    manifest_hash: str
    release_id: Optional[str] = None


class AgentRuntimeManifestPreviewRequest(AgentUpdate):
    pass


class AgentReleaseSnapshotRead(BaseModel):
    id: str
    org_id: str = ""
    agent_id: str
    version: int
    status: Literal["published"] = "published"
    spec_hash: str
    manifest_hash: str = ""
    agent_spec: Dict[str, Any] = Field(default_factory=dict)
    knowledge_snapshot_count: int = 0
    knowledge_snapshot_bytes: int = 0
    runtime_manifest: AgentRuntimeManifestRead
    created_at: str


class AgentPreflightCheckRead(BaseModel):
    key: str
    group: Literal["identity", "runtime", "model", "resources", "evaluation", "operations"]
    label: str
    passed: bool
    severity: Literal["blocker", "warning", "info"] = "blocker"
    detail: str = ""
    evidence: Dict[str, Any] = Field(default_factory=dict)


class AgentPreflightRead(BaseModel):
    agent_id: str
    agent_name: str
    runtime_plan_hash: str = ""
    manifest_hash: str = ""
    status: AgentLifecycleStatus
    score: int
    can_run: bool
    can_publish: bool
    blockers: int
    warnings: int
    checked_at: str
    runtime_manifest: AgentRuntimeManifestRead
    checks: List[AgentPreflightCheckRead]


class AgentRegressionCaseRead(BaseModel):
    id: str
    name: str
    status: Literal["active", "inactive"]
    result_status: Literal["untested", "running", "passed", "failed", "error"]
    freshness: Literal["current", "stale", "untested", "inactive"]
    input_preview: str = ""
    expected_keywords: List[str] = Field(default_factory=list)
    required_tools: List[str] = Field(default_factory=list)
    required_subagents: List[str] = Field(default_factory=list)
    required_event_types: List[str] = Field(default_factory=list)
    max_duration_ms: Optional[int] = None
    test_run_id: Optional[str] = None
    agent_run_id: Optional[str] = None
    last_runtime_plan_hash: str = ""
    current_runtime_plan_hash: str = ""
    last_run_at: Optional[str] = None
    last_error: str = ""


class AgentRegressionSuiteRunRead(BaseModel):
    id: str
    status: Literal["running", "completed", "failed"]
    runtime_plan_hash: str = ""
    is_current: bool = False
    total: int = 0
    passed: int = 0
    failed: int = 0
    duration_ms: int = 0
    started_at: str
    ended_at: Optional[str] = None


class AgentRegressionCoverageRead(BaseModel):
    agent_id: str
    agent_name: str
    runtime_plan_hash: str = ""
    generated_at: str
    total: int = 0
    active_cases: int = 0
    inactive_cases: int = 0
    passed: int = 0
    failed: int = 0
    running: int = 0
    stale: int = 0
    untested: int = 0
    coverage_percent: int = 0
    can_publish: bool = False
    blockers: List[str] = Field(default_factory=list)
    latest_suite_run: Optional[AgentRegressionSuiteRunRead] = None
    cases: List[AgentRegressionCaseRead] = Field(default_factory=list)


class RegressionQualityAgentRead(BaseModel):
    agent_id: str
    agent_name: str
    status: AgentLifecycleStatus
    version: int = 1
    runtime_plan_hash: str = ""
    coverage_percent: int = 0
    total: int = 0
    passed: int = 0
    failed: int = 0
    running: int = 0
    stale: int = 0
    untested: int = 0
    inactive_cases: int = 0
    can_publish: bool = False
    blockers: List[str] = Field(default_factory=list)
    latest_suite_run: Optional[AgentRegressionSuiteRunRead] = None


class RegressionQualityCaseRead(AgentRegressionCaseRead):
    agent_id: str
    agent_name: str
    agent_status: AgentLifecycleStatus
    severity: Literal["critical", "warning", "info"] = "warning"
    reason: str = ""


class RegressionQualityOverviewRead(BaseModel):
    generated_at: str
    agents: int = 0
    publish_ready_agents: int = 0
    blocked_agents: int = 0
    active_cases: int = 0
    passed: int = 0
    failed: int = 0
    running: int = 0
    stale: int = 0
    untested: int = 0
    inactive_cases: int = 0
    coverage_percent: int = 0
    blockers: int = 0
    agent_summaries: List[RegressionQualityAgentRead] = Field(default_factory=list)
    blocker_cases: List[RegressionQualityCaseRead] = Field(default_factory=list)


class ConversationRead(BaseModel):
    id: str
    org_id: str = ""
    agent_id: str
    title: str
    created_at: str
    updated_at: str


class MessageRead(BaseModel):
    id: str
    org_id: str = ""
    conversation_id: str
    role: str
    content: str
    created_at: str


class RunTraceEvent(BaseModel):
    seq: int
    step_id: str
    parent_seq: Optional[int] = None
    phase: Literal["setup", "reasoning", "tool", "subagent", "output", "complete", "error"]
    type: str
    label: str
    status: Literal["pending", "running", "success", "error", "info"] = "info"
    timestamp: str = ""
    elapsed_ms: int = 0
    duration_ms: int = 0
    resource: Optional[str] = None
    call_id: Optional[str] = None
    subagent: Optional[str] = None
    task: Optional[str] = None
    input_preview: str = ""
    output_preview: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)
    input: Any = None
    output: Any = None


class AgentRunRead(BaseModel):
    id: str
    org_id: str = ""
    agent_id: str
    agent_name: str = ""
    conversation_id: str
    rerun_of_run_id: Optional[str] = None
    derived_run_count: int = 0
    release_id: Optional[str] = None
    agent_version: int = 1
    spec_hash: str = ""
    manifest_hash: str = ""
    runtime_source: str = "release"
    entrypoint: str = "responses"
    run_source: str = "runtime"
    status: str
    model: str
    tools: List[str] = Field(default_factory=list)
    input_preview: str
    input_text: str = ""
    output_preview: str
    output_text: str = ""
    error: str
    duration_ms: int = 0
    first_token_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    llm_calls: int = 0
    events: List[RunTraceEvent] = Field(default_factory=list)
    subagents: List[SubAgentConfig] = Field(default_factory=list)
    runtime_manifest: Optional[AgentRuntimeManifestRead] = None
    knowledge_count: int = 0
    started_at: str
    ended_at: Optional[str] = None


class RunIncidentItemRead(BaseModel):
    run_id: str
    agent_id: str
    agent_name: str = ""
    status: Literal["failed", "stale", "running", "cancelled", "blocked"]
    severity: Literal["critical", "warning", "info"] = "warning"
    reason: str
    evidence: str = ""
    model: str = ""
    release_id: Optional[str] = None
    agent_version: int = 1
    spec_hash: str = ""
    input_preview: str = ""
    error_preview: str = ""
    duration_ms: int = 0
    age_minutes: int = 0
    started_at: str
    ended_at: Optional[str] = None


class RunIncidentQueueRead(BaseModel):
    key: Literal["blocked", "failed", "stale", "cancelled"]
    label: str
    count: int = 0
    severity: Literal["critical", "warning", "info"] = "warning"
    items: List[RunIncidentItemRead] = Field(default_factory=list)


class RunIncidentAgentRead(BaseModel):
    agent_id: str
    agent_name: str = ""
    failed: int = 0
    stale: int = 0
    cancelled: int = 0
    blocked: int = 0
    total: int = 0


class RunIncidentSummaryRead(BaseModel):
    total: int = 0
    window_minutes: int = 1440
    stale_threshold_minutes: int = 120
    generated_at: str
    queues: List[RunIncidentQueueRead] = Field(default_factory=list)
    by_agent: List[RunIncidentAgentRead] = Field(default_factory=list)


class RunRecoverySnapshotRead(BaseModel):
    run_id: str
    agent_id: str
    agent_name: str = ""
    status: str
    model: str = ""
    input_preview: str = ""
    output_preview: str = ""
    error_preview: str = ""
    duration_ms: int = 0
    first_token_ms: int = 0
    total_tokens: int = 0
    llm_calls: int = 0
    started_at: str
    ended_at: Optional[str] = None


class RunRecoveryDeltaRead(BaseModel):
    duration_ms: int = 0
    first_token_ms: int = 0
    total_tokens: int = 0
    llm_calls: int = 0


class RunRecoveryRead(BaseModel):
    source_run: RunRecoverySnapshotRead
    latest_rerun: Optional[RunRecoverySnapshotRead] = None
    rerun_count: int = 0
    status: Literal["not_rerun", "verifying", "recovered", "unresolved"] = "not_rerun"
    verdict: str = ""
    deltas: RunRecoveryDeltaRead = Field(default_factory=RunRecoveryDeltaRead)
    candidates: List[RunRecoverySnapshotRead] = Field(default_factory=list)


class RunToTestCaseRequest(BaseModel):
    name: Optional[str] = None
    expected_keywords: Optional[List[str]] = None
    max_duration_ms: Optional[int] = Field(default=None, ge=1)


class LLMInvocationLogRead(BaseModel):
    id: str
    org_id: str = ""
    agent_id: str
    run_id: str
    conversation_id: str
    llm_config_id: str
    provider_type: str = ""
    model: str = ""
    runtime_scope: str = "main"
    subagent_name: str = ""
    source: str = "runtime"
    status: str = "success"
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    llm_calls: int = 0
    duration_ms: int = 0
    first_token_ms: int = 0
    error: str = ""
    created_at: str


class KnowledgeRetrievalChunkRef(BaseModel):
    document_id: str = ""
    file_name: str = ""
    chunk_id: str = ""
    ordinal: int = 0
    content_hash: str = ""
    preview: str = ""


class KnowledgeRetrievalAuditRead(BaseModel):
    id: str
    org_id: str = ""
    agent_id: str
    run_id: str
    conversation_id: str
    source: str = "runtime"
    query_preview: str = ""
    index_source: str = ""
    indexed_chunks: int = 0
    retrieved_chunks: int = 0
    terms: List[str] = Field(default_factory=list)
    chunk_refs: List[KnowledgeRetrievalChunkRef] = Field(default_factory=list)
    created_at: str


class AgentTestAssertion(BaseModel):
    required_keywords: List[str] = Field(default_factory=list)
    required_tools: List[str] = Field(default_factory=list)
    required_subagents: List[str] = Field(default_factory=list)
    required_event_types: List[str] = Field(default_factory=list)
    required_json_schema: Dict[str, Any] = Field(default_factory=dict)
    max_duration_ms: Optional[int] = Field(default=None, ge=1)
    source_run_id: str = ""
    source_run_status: str = ""
    source_run_model: str = ""
    source_run_spec_hash: str = ""


class AgentTestCaseBase(BaseModel):
    name: str
    input_text: str
    expected_keywords: List[str] = Field(default_factory=list)
    assertion: AgentTestAssertion = Field(default_factory=AgentTestAssertion)
    status: Literal["active", "inactive"] = "active"


class AgentTestCaseCreate(AgentTestCaseBase):
    pass


class AgentTestCaseUpdate(BaseModel):
    name: Optional[str] = None
    input_text: Optional[str] = None
    expected_keywords: Optional[List[str]] = None
    assertion: Optional[AgentTestAssertion] = None
    status: Optional[Literal["active", "inactive"]] = None


class AgentTestCaseRead(AgentTestCaseBase):
    id: str
    org_id: str = ""
    agent_id: str
    last_status: str = "untested"
    last_output: str = ""
    last_error: str = ""
    last_run_id: Optional[str] = None
    last_runtime_plan_hash: str = ""
    last_run_at: Optional[str] = None
    created_at: str
    updated_at: str


class AgentTestRunRead(BaseModel):
    id: str
    org_id: str = ""
    agent_id: str
    case_id: str
    suite_run_id: Optional[str] = None
    agent_run_id: Optional[str] = None
    conversation_id: str = ""
    runtime_plan_hash: str = ""
    case_name: str
    input_text: str
    expected_keywords: List[str] = Field(default_factory=list)
    assertion: AgentTestAssertion = Field(default_factory=AgentTestAssertion)
    status: str = "running"
    output: str = ""
    error: str = ""
    assertion_errors: List[str] = Field(default_factory=list)
    duration_ms: int = 0
    started_at: str
    ended_at: Optional[str] = None


class AgentTestSuiteRunRead(BaseModel):
    id: str = ""
    org_id: str = ""
    agent_id: str
    runtime_plan_hash: str = ""
    status: str = "running"
    total: int
    passed: int
    failed: int
    duration_ms: int = 0
    started_at: str = ""
    ended_at: Optional[str] = None
    cases: List[AgentTestCaseRead]
    runs: List[AgentTestRunRead] = Field(default_factory=list)


class CanonicalMessage(BaseModel):
    role: Literal["system", "developer", "user", "assistant"]
    content: str


class AgentInvocationRequest(BaseModel):
    message: str
    messages: List[CanonicalMessage] = Field(default_factory=list)
    conversation_id: Optional[str] = None
    execution_context_id: Optional[str] = None
    attachment_ids: List[str] = Field(default_factory=list)
    preview: bool = False
    entrypoint: str = "responses"
    run_source: str = "runtime"
    trace_label: str = "执行引擎启动"
    done_label: str = "运行完成"
    error_label: str = "运行失败"
    rerun_of_run_id: Optional[str] = None
    persist_messages: bool = True
    runtime_plan_override: Any = None


class UploadRead(BaseModel):
    id: str
    org_id: str = ""
    file_name: str
    content_type: Optional[str]
    size: int


class KnowledgeDocumentRead(BaseModel):
    id: str
    org_id: str = ""
    agent_id: str
    file_name: str
    content_type: Optional[str]
    size: int
    char_count: int = 0
    preview: str = ""
    status: str
    created_at: str
    chunk_count: int = 0


class KnowledgeChunkRead(BaseModel):
    id: str
    document_id: str
    file_name: str
    ordinal: int
    text: str
    char_count: int
    content_hash: str = ""
    chunk_hash: str = ""
    embedding_status: str = "not_configured"
    embedding_model: Optional[str] = None
    vector_ref: Optional[str] = None
    created_at: str


class KnowledgeDocumentDetail(KnowledgeDocumentRead):
    content: str = ""
    chunks: List[KnowledgeChunkRead] = Field(default_factory=list)


class ToolBase(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{2,64}$")
    name: str
    description: str = ""
    category: str = "custom"
    implementation: Literal["builtin", "http", "mcp"] = "builtin"
    metadata: Dict[str, Any] = Field(default_factory=dict)
    status: Literal["active", "inactive"] = "active"


class ToolCreate(ToolBase):
    pass


class ToolRead(ToolBase):
    id: str
    org_id: str = ""
    enabled: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ToolUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    implementation: Optional[Literal["builtin", "http", "mcp"]] = None
    metadata: Optional[Dict[str, Any]] = None
    status: Optional[Literal["active", "inactive"]] = None


class ToolInvokeRequest(BaseModel):
    input: Any = None


class ToolInvokeRead(BaseModel):
    tool_id: str
    output: str


class ToolHealthCheckRead(BaseModel):
    key: str
    label: str
    passed: bool
    severity: Literal["blocker", "warning", "info"] = "blocker"
    detail: str = ""
    evidence: Dict[str, Any] = Field(default_factory=dict)


class ToolHealthRead(BaseModel):
    tool_id: str
    name: str
    implementation: str
    status: str
    ready: bool
    score: int
    blockers: int
    warnings: int
    last_invocation_status: Optional[str] = None
    last_invoked_at: Optional[str] = None
    checks: List[ToolHealthCheckRead] = Field(default_factory=list)


class OpenAPIImportRequest(BaseModel):
    spec: Dict[str, Any]
    prefix: str = Field(default="", pattern=r"^[a-zA-Z0-9_-]{0,32}$")
    category: str = "openapi"
    overwrite: bool = False
    allow_private_networks: bool = False


class OpenAPIImportRead(BaseModel):
    imported: int
    skipped: int = 0
    tools: List[ToolRead] = Field(default_factory=list)


class MCPServerRequest(BaseModel):
    metadata: Dict[str, Any]


class MCPDiscoveredToolRead(BaseModel):
    name: str
    description: str = ""
    args_schema: Dict[str, Any] = Field(default_factory=dict)


class MCPDiscoveryRead(BaseModel):
    tools: List[MCPDiscoveredToolRead] = Field(default_factory=list)


class MCPImportRequest(MCPServerRequest):
    prefix: str = Field(default="", pattern=r"^[a-zA-Z0-9_-]{0,32}$")
    category: str = "mcp"
    tool_names: List[str] = Field(default_factory=list)
    overwrite: bool = False


class MCPImportRead(BaseModel):
    imported: int
    skipped: int = 0
    tools: List[ToolRead] = Field(default_factory=list)


class ToolSecretBase(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{2,64}$")
    name: str
    description: str = ""


class ToolSecretCreate(ToolSecretBase):
    value: str = Field(min_length=1)


class ToolSecretUpdate(BaseModel):
    name: Optional[str] = None
    value: Optional[str] = Field(default=None, min_length=1)
    description: Optional[str] = None


class ToolSecretRead(ToolSecretBase):
    org_id: str = ""
    configured: bool = True
    created_at: str
    updated_at: str


class ToolInvocationAuditRead(BaseModel):
    id: str
    org_id: str = ""
    user_id: Optional[str] = None
    actor_role: str = ""
    source: str = "manual"
    agent_id: Optional[str] = None
    run_id: Optional[str] = None
    conversation_id: Optional[str] = None
    call_id: Optional[str] = None
    tool_id: str
    implementation: str
    status: str
    method: str = ""
    url: str = ""
    request_preview: str = ""
    response_preview: str = ""
    error: str = ""
    duration_ms: int = 0
    created_at: str


class RunEvidenceRead(BaseModel):
    run: AgentRunRead
    replay_request: Dict[str, Any] = Field(default_factory=dict)
    runtime_snapshot: Dict[str, Any] = Field(default_factory=dict)
    llm_logs: List[LLMInvocationLogRead] = Field(default_factory=list)
    tool_audits: List[ToolInvocationAuditRead] = Field(default_factory=list)
    knowledge_audits: List[KnowledgeRetrievalAuditRead] = Field(default_factory=list)


class SkillBase(BaseModel):
    name: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64)
    display_name: str
    description: str = Field(max_length=1024)
    instructions: str
    allowed_tools: List[str] = Field(default_factory=list)
    metadata: Dict[str, str] = Field(default_factory=dict)
    status: Literal["active", "inactive"] = "active"


class SkillCreate(SkillBase):
    pass


class SkillUpdate(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=1024)
    instructions: Optional[str] = None
    allowed_tools: Optional[List[str]] = None
    metadata: Optional[Dict[str, str]] = None
    status: Optional[Literal["active", "inactive"]] = None


class SkillRead(SkillBase):
    id: str
    org_id: str = ""
    version: int
    created_at: str
    updated_at: str


class SkillVersionRead(SkillBase):
    id: str
    org_id: str = ""
    skill_id: str
    version: int
    created_at: str


class SkillRuntimePreviewRead(BaseModel):
    skill_id: str
    name: str
    markdown: str
    allowed_tools: List[RuntimeResourceRead] = Field(default_factory=list)
    missing_tools: List[str] = Field(default_factory=list)
    inactive_tools: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class SkillHealthCheckRead(BaseModel):
    key: str
    label: str
    passed: bool
    severity: Literal["blocker", "warning", "info"] = "blocker"
    detail: str = ""
    evidence: Dict[str, Any] = Field(default_factory=dict)


class SkillHealthRead(BaseModel):
    skill_id: str
    name: str
    display_name: str
    status: str
    ready: bool
    score: int
    blockers: int
    warnings: int
    bound_agents: int = 0
    published_agents: int = 0
    checks: List[SkillHealthCheckRead] = Field(default_factory=list)


class SkillAgentBindingRead(BaseModel):
    agent_id: str
    agent_name: str
    agent_status: AgentLifecycleStatus
    binding: Literal["main", "subagent"]
    subagent_name: Optional[str] = None


class SkillImpactRead(BaseModel):
    skill_id: str
    skill_name: str
    total_agents: int = 0
    published_agents: int = 0
    bindings: List[SkillAgentBindingRead] = Field(default_factory=list)


class SkillChangeRead(BaseModel):
    field: str
    before: str = ""
    after: str = ""


class SkillImportPreviewRead(BaseModel):
    name: str
    action: Literal["create", "overwrite"]
    existing_skill_id: Optional[str] = None
    incoming_version: int = 1
    imported_versions: int = 0
    missing_tools: List[str] = Field(default_factory=list)
    inactive_tools: List[str] = Field(default_factory=list)
    changes: List[SkillChangeRead] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class SkillVersionDiffRead(BaseModel):
    skill_id: str
    version: int
    changes: List[SkillChangeRead] = Field(default_factory=list)


class SkillExportRead(BaseModel):
    kind: Literal["agent-forge.skill"] = "agent-forge.skill"
    schema_version: int = 1
    skill: SkillRead
    versions: List[SkillVersionRead] = Field(default_factory=list)


class SkillImportRequest(BaseModel):
    package: Dict[str, Any]
    overwrite: bool = False
    preserve_id: bool = False


class Envelope(BaseModel):
    data: Any
