export interface ModelConfig {
  name: string;
  is_reasoning_model: boolean;
}

export type AgentLifecycleStatus = 'unpublished' | 'published' | 'inactive';

export interface LLMConfig {
  id: string;
  org_id?: string | null;
  name: string;
  provider_type: string;
  api_key: string;
  api_key_configured: boolean;
  base_url?: string | null;
  available_models: ModelConfig[];
  default_model: string;
  temperature: number;
  max_tokens: number;
  extra_headers: Record<string, string>;
  status: 'active' | 'inactive';
  last_check_status: 'healthy' | 'failed' | 'unchecked';
  last_check_message: string;
  last_checked_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LLMCheckResult {
  id: string;
  status: 'healthy' | 'failed' | 'unchecked';
  message: string;
  checked_at: string;
}

export type OrganizationRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  display_name: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  org_id: string;
  user_id: string;
  role: OrganizationRole;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMemberUser extends OrganizationMember {
  user_email: string;
  user_display_name: string;
  user_status: string;
  user_last_login_at?: string | null;
}

export interface AuthSession {
  access_token: string;
  token_type: 'bearer';
  expires_at?: string | null;
  user: User;
  organization: Organization;
  membership: OrganizationMember;
}

export interface CurrentUser {
  user: User;
  organization: Organization;
  membership: OrganizationMember;
}

export interface ApiToken {
  id: string;
  name: string;
  token_type: string;
  status: string;
  expires_at?: string | null;
  last_used_at?: string | null;
  revoked_at?: string | null;
  revoked_by?: string | null;
  created_at: string;
}

export interface ApiTokenCreated extends ApiToken {
  token: string;
}

export interface OrganizationApiToken extends ApiToken {
  user_id: string;
  user_email: string;
  user_display_name: string;
  user_role?: OrganizationRole | null;
  user_status: string;
  revoked_by_email: string;
  revoked_by_display_name: string;
}

export interface AuditLog {
  id: string;
  org_id?: string | null;
  user_id?: string | null;
  user_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  status: string;
  ip: string;
  user_agent: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ModelOverride {
  temperature?: number | null;
  max_tokens?: number | null;
  top_p?: number | null;
}

export interface FixedReply {
  keywords: string[];
  reply: string;
}

export interface SubAgentConfig {
  name: string;
  description: string;
  system_prompt: string;
  llm_config_id?: string | null;
  model?: string | null;
  tools: string[];
  skills: string[];
  memory: string[];
  interrupt_on: Record<string, boolean>;
  permissions?: PermissionConfig | null;
  output: OutputConfig;
}

export interface FilesystemConfig {
  enabled: boolean;
  mode: 'state' | 'virtual';
  read_only: boolean;
}

export interface PermissionConfig {
  allow_write: boolean;
  allowed_paths: string[];
}

export interface RuntimeConfig {
  backend_type: 'state' | 'filesystem' | 'store';
  debug: boolean;
  checkpointing: boolean;
  interrupt_on: Record<string, boolean>;
}

export interface OutputConfig {
  mode: 'text' | 'json_schema';
  json_schema: Record<string, unknown>;
}

export interface HarnessConfig {
  excluded_tools: string[];
  tool_description_overrides: Record<string, string>;
  disable_general_purpose_subagent: boolean;
}

export interface Agent {
  id: string;
  org_id?: string | null;
  name: string;
  slug: string;
  description: string;
  system_prompt: string;
  llm_config_id: string;
  model: string;
  engine_mode: 'deepagents';
  tools: string[];
  skills: string[];
  subagents: SubAgentConfig[];
  memory: string[];
  filesystem: FilesystemConfig;
  permissions: PermissionConfig;
  runtime: RuntimeConfig;
  output: OutputConfig;
  harness: HarnessConfig;
  metadata: Record<string, unknown>;
  model_override: ModelOverride;
  routing: {
    fixed_replies: FixedReply[];
  };
  context_config: {
    max_rounds: number;
  };
  max_iterations: number;
  status: AgentLifecycleStatus;
  version: number;
  published_at?: string | null;
  current_spec_hash: string;
  latest_release_spec_hash: string;
  config_pending_publish: boolean;
  created_at: string;
  updated_at: string;
}

export interface RuntimeResource {
  id: string;
  name: string;
  status: string;
  kind: string;
  metadata: Record<string, unknown>;
}

export interface RuntimeKnowledgeManifest {
  id: string;
  file_name: string;
  content_type: string;
  size: number;
  snapshot_size: number;
  char_count: number;
  content_hash: string;
  chunk_count: number;
  chunk_source: string;
}

export interface RuntimeSubAgentManifest {
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  llm_config_id?: string | null;
  tools: RuntimeResource[];
  skills: RuntimeResource[];
  memory: string[];
  interrupt_on: Record<string, boolean>;
  permissions: PermissionConfig;
  output: OutputConfig;
}

export interface RuntimeModelContract {
  scope: 'main' | 'subagent';
  subagent: string;
  llm_config_id: string;
  provider_type: string;
  base_url?: string | null;
  model: string;
  default_headers: Record<string, unknown>;
  temperature?: number | null;
  max_tokens?: number | null;
  top_p?: number | null;
  api_key_ref: string;
  status: string;
}

export interface AgentRuntimeManifest {
  agent_id: string;
  agent_name: string;
  engine_mode: 'deepagents';
  system_prompt: string;
  model: string;
  llm_config_id: string;
  backend_type: 'state' | 'filesystem' | 'store';
  checkpointing: boolean;
  debug: boolean;
  main_tools: RuntimeResource[];
  main_skills: RuntimeResource[];
  subagents: RuntimeSubAgentManifest[];
  model_contracts: RuntimeModelContract[];
  memory: string[];
  interrupt_on: Record<string, boolean>;
  permissions: PermissionConfig;
  filesystem: FilesystemConfig;
  output: OutputConfig;
  harness: HarnessConfig;
  knowledge: RuntimeKnowledgeManifest[];
  missing_tools: string[];
  missing_skills: string[];
  inactive_tools: string[];
  inactive_skills: string[];
  warnings: string[];
}

export interface AgentRuntimeManifestEnvelope {
  source: 'draft' | 'preview' | 'release';
  manifest: AgentRuntimeManifest;
  manifest_hash: string;
  release_id?: string | null;
}

export interface AgentReleaseSnapshot {
  id: string;
  org_id?: string | null;
  agent_id: string;
  version: number;
  status: string;
  spec_hash: string;
  manifest_hash: string;
  agent_spec: Partial<Agent>;
  knowledge_snapshot_count: number;
  knowledge_snapshot_bytes: number;
  runtime_manifest: AgentRuntimeManifest;
  created_at: string;
}

export interface AgentPreflightCheck {
  key: string;
  group: 'identity' | 'runtime' | 'model' | 'resources' | 'evaluation' | 'operations';
  label: string;
  passed: boolean;
  severity: 'blocker' | 'warning' | 'info';
  detail: string;
  evidence: Record<string, unknown>;
}

export interface AgentPreflight {
  agent_id: string;
  agent_name: string;
  runtime_plan_hash: string;
  manifest_hash: string;
  status: AgentLifecycleStatus;
  score: number;
  can_run: boolean;
  can_publish: boolean;
  blockers: number;
  warnings: number;
  checked_at: string;
  runtime_manifest: AgentRuntimeManifest;
  checks: AgentPreflightCheck[];
}

export interface AgentRegressionCase {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  result_status: 'untested' | 'running' | 'passed' | 'failed' | 'error';
  freshness: 'current' | 'stale' | 'untested' | 'inactive';
  input_preview: string;
  expected_keywords: string[];
  required_tools: string[];
  required_subagents: string[];
  required_event_types: string[];
  max_duration_ms?: number | null;
  test_run_id?: string | null;
  agent_run_id?: string | null;
  last_runtime_plan_hash: string;
  current_runtime_plan_hash: string;
  last_run_at?: string | null;
  last_error: string;
}

export interface AgentRegressionSuiteRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  runtime_plan_hash: string;
  is_current: boolean;
  total: number;
  passed: number;
  failed: number;
  duration_ms: number;
  started_at: string;
  ended_at?: string | null;
}

export interface AgentRegressionCoverage {
  agent_id: string;
  agent_name: string;
  runtime_plan_hash: string;
  generated_at: string;
  total: number;
  active_cases: number;
  inactive_cases: number;
  passed: number;
  failed: number;
  running: number;
  stale: number;
  untested: number;
  coverage_percent: number;
  can_publish: boolean;
  blockers: string[];
  latest_suite_run?: AgentRegressionSuiteRun | null;
  cases: AgentRegressionCase[];
}

export interface RegressionQualityAgent {
  agent_id: string;
  agent_name: string;
  status: AgentLifecycleStatus;
  version: number;
  runtime_plan_hash: string;
  coverage_percent: number;
  total: number;
  passed: number;
  failed: number;
  running: number;
  stale: number;
  untested: number;
  inactive_cases: number;
  can_publish: boolean;
  blockers: string[];
  latest_suite_run?: AgentRegressionSuiteRun | null;
}

export interface RegressionQualityCase extends AgentRegressionCase {
  agent_id: string;
  agent_name: string;
  agent_status: AgentLifecycleStatus;
  severity: 'critical' | 'warning' | 'info';
  reason: string;
}

export interface RegressionQualityOverview {
  generated_at: string;
  agents: number;
  publish_ready_agents: number;
  blocked_agents: number;
  active_cases: number;
  passed: number;
  failed: number;
  running: number;
  stale: number;
  untested: number;
  inactive_cases: number;
  coverage_percent: number;
  blockers: number;
  agent_summaries: RegressionQualityAgent[];
  blocker_cases: RegressionQualityCase[];
}

export interface Skill {
  id: string;
  org_id?: string | null;
  name: string;
  display_name: string;
  description: string;
  instructions: string;
  allowed_tools: string[];
  metadata: Record<string, string>;
  version: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface SkillVersion extends Skill {
  org_id?: string | null;
  skill_id: string;
  created_at: string;
}

export interface SkillRuntimePreview {
  skill_id: string;
  name: string;
  markdown: string;
  allowed_tools: RuntimeResource[];
  missing_tools: string[];
  inactive_tools: string[];
  warnings: string[];
}

export interface SkillHealthCheck {
  key: string;
  label: string;
  passed: boolean;
  severity: 'blocker' | 'warning' | 'info';
  detail: string;
  evidence: Record<string, unknown>;
}

export interface SkillHealth {
  skill_id: string;
  name: string;
  display_name: string;
  status: string;
  ready: boolean;
  score: number;
  blockers: number;
  warnings: number;
  bound_agents: number;
  published_agents: number;
  checks: SkillHealthCheck[];
}

export interface SkillAgentBinding {
  agent_id: string;
  agent_name: string;
  agent_status: AgentLifecycleStatus;
  binding: 'main' | 'subagent';
  subagent_name?: string | null;
}

export interface SkillImpact {
  skill_id: string;
  skill_name: string;
  total_agents: number;
  published_agents: number;
  bindings: SkillAgentBinding[];
}

export interface SkillChange {
  field: string;
  before: string;
  after: string;
}

export interface SkillImportPreview {
  name: string;
  action: 'create' | 'overwrite';
  existing_skill_id?: string | null;
  incoming_version: number;
  imported_versions: number;
  missing_tools: string[];
  inactive_tools: string[];
  changes: SkillChange[];
  warnings: string[];
}

export interface SkillVersionDiff {
  skill_id: string;
  version: number;
  changes: SkillChange[];
}

export interface SkillExportPackage {
  kind: 'agent-forge.skill';
  schema_version: number;
  skill: Skill;
  versions: SkillVersion[];
}

export interface AgentCompletenessItem {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface AgentCompleteness {
  agent_id: string;
  score: number;
  can_publish: boolean;
  items: AgentCompletenessItem[];
}

export interface Conversation {
  id: string;
  org_id?: string | null;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  org_id?: string | null;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface UploadResult {
  id: string;
  org_id?: string | null;
  file_name: string;
  content_type?: string | null;
  size: number;
}

export interface KnowledgeDocument {
  id: string;
  org_id?: string | null;
  agent_id: string;
  file_name: string;
  content_type?: string | null;
  size: number;
  char_count: number;
  preview: string;
  status: string;
  created_at: string;
  chunk_count: number;
}

export interface KnowledgeChunk {
  id: string;
  document_id: string;
  file_name: string;
  ordinal: number;
  text: string;
  char_count: number;
  content_hash: string;
  chunk_hash: string;
  embedding_status: string;
  embedding_model?: string | null;
  vector_ref?: string | null;
  created_at: string;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocument {
  content: string;
  chunks: KnowledgeChunk[];
}

export type ToolRequiredRole = OrganizationRole;

export interface ToolMetadata extends Record<string, unknown> {
  required_role?: ToolRequiredRole;
}

export interface ToolDefinition {
  id: string;
  org_id?: string | null;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  implementation: 'builtin' | 'http' | 'mcp';
  metadata: ToolMetadata;
  status: 'active' | 'inactive';
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ToolInvokeResult {
  tool_id: string;
  output: string;
}

export interface ToolHealthCheck {
  key: string;
  label: string;
  passed: boolean;
  severity: 'blocker' | 'warning' | 'info';
  detail: string;
  evidence: Record<string, unknown>;
}

export interface ToolHealth {
  tool_id: string;
  name: string;
  implementation: string;
  status: string;
  ready: boolean;
  score: number;
  blockers: number;
  warnings: number;
  last_invocation_status?: string | null;
  last_invoked_at?: string | null;
  checks: ToolHealthCheck[];
}

export interface ToolSecret {
  id: string;
  org_id?: string | null;
  name: string;
  description: string;
  configured: boolean;
  created_at: string;
  updated_at: string;
}

export interface ToolInvocationAudit {
  id: string;
  org_id?: string | null;
  user_id?: string | null;
  actor_role?: OrganizationRole | string | null;
  source?: 'manual' | 'runtime' | 'test' | 'system' | string | null;
  agent_id?: string | null;
  run_id?: string | null;
  conversation_id?: string | null;
  call_id?: string | null;
  tool_id: string;
  implementation: string;
  status: 'success' | 'failed' | string;
  method: string;
  url: string;
  request_preview: string;
  response_preview: string;
  error: string;
  duration_ms: number;
  created_at: string;
}

export interface OpenAPIImportResult {
  imported: number;
  skipped: number;
  tools: ToolDefinition[];
}

export interface McpDiscoveredTool {
  name: string;
  description: string;
  args_schema: Record<string, unknown>;
}

export interface McpDiscoveryResult {
  tools: McpDiscoveredTool[];
}

export interface McpImportResult {
  imported: number;
  skipped: number;
  tools: ToolDefinition[];
}

export interface RunTraceEvent {
  seq: number;
  step_id: string;
  parent_seq?: number | null;
  phase: 'setup' | 'reasoning' | 'tool' | 'subagent' | 'output' | 'complete' | 'error';
  type: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'info';
  timestamp: string;
  elapsed_ms: number;
  duration_ms: number;
  resource?: string | null;
  call_id?: string | null;
  subagent?: string | null;
  task?: string | null;
  input_preview: string;
  output_preview: string;
  metadata: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
}

export interface AgentRun {
  id: string;
  org_id?: string | null;
  agent_id: string;
  agent_name: string;
  conversation_id: string;
  rerun_of_run_id?: string | null;
  derived_run_count?: number;
  release_id?: string | null;
  agent_version: number;
  spec_hash: string;
  manifest_hash: string;
  runtime_source: 'preview' | 'publish' | 'release' | 'snapshot' | string;
  entrypoint: 'responses' | 'chat_completions' | string;
  run_source: 'runtime' | 'test_case' | 'rerun' | string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'stale' | 'blocked';
  model: string;
  tools: string[];
  input_preview: string;
  input_text: string;
  output_preview: string;
  output_text: string;
  error: string;
  duration_ms: number;
  first_token_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  llm_calls: number;
  events: RunTraceEvent[];
  subagents: SubAgentConfig[];
  runtime_manifest?: AgentRuntimeManifest | null;
  knowledge_count: number;
  started_at: string;
  ended_at?: string | null;
}

export interface RunIncidentItem {
  run_id: string;
  agent_id: string;
  agent_name: string;
  status: 'failed' | 'stale' | 'running' | 'cancelled' | 'blocked';
  severity: 'critical' | 'warning' | 'info';
  reason: string;
  evidence: string;
  model: string;
  release_id?: string | null;
  agent_version: number;
  spec_hash: string;
  input_preview: string;
  error_preview: string;
  duration_ms: number;
  age_minutes: number;
  started_at: string;
  ended_at?: string | null;
}

export interface RunIncidentQueue {
  key: 'blocked' | 'failed' | 'stale' | 'cancelled';
  label: string;
  count: number;
  severity: 'critical' | 'warning' | 'info';
  items: RunIncidentItem[];
}

export interface RunIncidentAgent {
  agent_id: string;
  agent_name: string;
  failed: number;
  stale: number;
  cancelled: number;
  blocked: number;
  total: number;
}

export interface RunIncidentSummary {
  total: number;
  window_minutes: number;
  stale_threshold_minutes: number;
  generated_at: string;
  queues: RunIncidentQueue[];
  by_agent: RunIncidentAgent[];
}

export interface RunRecoverySnapshot {
  run_id: string;
  agent_id: string;
  agent_name: string;
  status: AgentRun['status'];
  model: string;
  input_preview: string;
  output_preview: string;
  error_preview: string;
  duration_ms: number;
  first_token_ms: number;
  total_tokens: number;
  llm_calls: number;
  started_at: string;
  ended_at?: string | null;
}

export interface RunRecoveryDelta {
  duration_ms: number;
  first_token_ms: number;
  total_tokens: number;
  llm_calls: number;
}

export interface RunRecovery {
  source_run: RunRecoverySnapshot;
  latest_rerun?: RunRecoverySnapshot | null;
  rerun_count: number;
  status: 'not_rerun' | 'verifying' | 'recovered' | 'unresolved';
  verdict: string;
  deltas: RunRecoveryDelta;
  candidates: RunRecoverySnapshot[];
}

export interface RunEvidence {
  run: AgentRun;
  replay_request: Record<string, unknown>;
  runtime_snapshot: Record<string, unknown>;
  llm_logs: LLMInvocationLog[];
  tool_audits: ToolInvocationAudit[];
  knowledge_audits: KnowledgeRetrievalAudit[];
}

export interface LLMInvocationLog {
  id: string;
  org_id?: string | null;
  agent_id: string;
  run_id: string;
  conversation_id: string;
  llm_config_id: string;
  provider_type: string;
  model: string;
  runtime_scope: string;
  subagent_name: string;
  source: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  llm_calls: number;
  duration_ms: number;
  first_token_ms: number;
  error: string;
  created_at: string;
}

export interface KnowledgeRetrievalChunkRef {
  document_id: string;
  file_name: string;
  chunk_id: string;
  ordinal: number;
  content_hash: string;
  preview: string;
}

export interface KnowledgeRetrievalAudit {
  id: string;
  org_id?: string | null;
  agent_id: string;
  run_id: string;
  conversation_id: string;
  source: string;
  query_preview: string;
  index_source: string;
  indexed_chunks: number;
  retrieved_chunks: number;
  terms: string[];
  chunk_refs: KnowledgeRetrievalChunkRef[];
  created_at: string;
}

export interface MonitorStats {
  agents: number;
  published_agents: number;
  llm_configs: number;
  active_llm_configs: number;
  conversations: number;
  messages: number;
  runs: number;
  completed_runs: number;
  failed_runs: number;
  running_runs: number;
  cancelled_runs: number;
  stale_runs: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_first_token_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  llm_calls: number;
  knowledge_documents: number;
  test_cases: number;
  passed_test_cases: number;
  runtime_state_bytes: number;
  checkpoint_bytes: number;
  store_bytes: number;
  checkpoints: number;
  checkpoint_writes: number;
  store_items: number;
}

export interface LLMUsageBreakdownItem {
  runtime_scope: string;
  subagent_name: string;
  provider_type: string;
  model: string;
  llm_config_id: string;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface LLMUsageBreakdown {
  total_llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  items: LLMUsageBreakdownItem[];
}

export interface LLMHealthBreakdownItem {
  runtime_scope: string;
  subagent_name: string;
  provider_type: string;
  model: string;
  llm_config_id: string;
  total_llm_calls: number;
  success_llm_calls: number;
  failed_llm_calls: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_first_token_ms: number;
  total_tokens: number;
  last_error: string;
}

export interface LLMHealthBreakdown {
  total_llm_calls: number;
  success_llm_calls: number;
  failed_llm_calls: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_first_token_ms: number;
  items: LLMHealthBreakdownItem[];
}

export interface PlatformReadinessCheck {
  key: string;
  label: string;
  ready: boolean;
  severity: 'blocker' | 'warning' | 'info';
  detail: string;
  evidence: Record<string, unknown>;
}

export interface PlatformReadiness {
  status: 'ready' | 'degraded' | 'blocked';
  environment: string;
  checked_at: string;
  blockers: number;
  warnings: number;
  checks: PlatformReadinessCheck[];
}

export interface RunRetentionPolicy {
  retain_days: number;
  retain_minimum: number;
  include_running: boolean;
}

export interface RunRetentionRequest {
  retain_days?: number | null;
  retain_minimum?: number | null;
  include_running?: boolean;
}

export interface RunRetentionCandidate {
  id: string;
  agent_id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
}

export interface RunRetentionResult {
  policy: RunRetentionPolicy;
  total_runs: number;
  eligible_runs: number;
  retained_runs: number;
  deleted_runs: number;
  protected_test_runs: number;
  protected_minimum_runs: number;
  protected_running_runs: number;
  deleted_llm_logs: number;
  deleted_tool_audits: number;
  deleted_knowledge_audits: number;
  deleted_run_events: number;
  cleared_rerun_links: number;
  cutoff_at: string;
  dry_run: boolean;
  candidate_runs: RunRetentionCandidate[];
}

export interface RuntimeState {
  backend: 'postgres' | 'sqlite' | 'memory';
  state_dir: string;
  checkpoint_db: string;
  store_db: string;
  checkpoint_exists: boolean;
  store_exists: boolean;
  status: 'healthy' | 'warning';
  warnings: string[];
  runtime_state_bytes: number;
  checkpoint_bytes: number;
  store_bytes: number;
  checkpoints: number;
  checkpoint_writes: number;
  store_items: number;
  postgres_package_available?: boolean | null;
}

export interface UploadQuota {
  max_total_bytes: number;
  used_bytes: number;
  remaining_bytes: number;
  attachment_bytes: number;
  knowledge_bytes: number;
  usage_percent: number;
  upload_max_bytes: number;
  knowledge_upload_max_bytes: number;
  allowed_extensions: string[];
  allowed_content_types: string[];
}

export interface AgentTestAssertion {
  required_keywords: string[];
  required_tools: string[];
  required_subagents: string[];
  required_event_types: string[];
  required_json_schema: Record<string, unknown>;
  max_duration_ms?: number | null;
  source_run_id?: string;
  source_run_status?: string;
  source_run_model?: string;
  source_run_spec_hash?: string;
}

export interface AgentTestCase {
  id: string;
  org_id?: string | null;
  agent_id: string;
  name: string;
  input_text: string;
  expected_keywords: string[];
  assertion: AgentTestAssertion;
  status: 'active' | 'inactive';
  last_status: 'untested' | 'passed' | 'failed';
  last_output: string;
  last_error: string;
  last_run_id?: string | null;
  last_runtime_plan_hash: string;
  last_run_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentTestRun {
  id: string;
  org_id?: string | null;
  agent_id: string;
  case_id: string;
  suite_run_id?: string | null;
  agent_run_id?: string | null;
  conversation_id: string;
  runtime_plan_hash: string;
  case_name: string;
  input_text: string;
  expected_keywords: string[];
  assertion: AgentTestAssertion;
  status: 'running' | 'passed' | 'failed' | 'error';
  output: string;
  error: string;
  assertion_errors: string[];
  duration_ms: number;
  started_at: string;
  ended_at?: string | null;
}

export interface AgentTestSuiteRun {
  id: string;
  org_id?: string | null;
  agent_id: string;
  runtime_plan_hash: string;
  status: 'running' | 'completed' | 'failed';
  total: number;
  passed: number;
  failed: number;
  duration_ms: number;
  started_at: string;
  ended_at?: string | null;
  cases: AgentTestCase[];
  runs: AgentTestRun[];
}
