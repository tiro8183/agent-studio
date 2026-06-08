import type { Agent, AgentCompleteness, AgentPreflight, AgentRegressionCoverage, AgentReleaseSnapshot, AgentRun, AgentRuntimeManifestEnvelope, AgentTestCase, AgentTestRun, AgentTestSuiteRun, ApiToken, ApiTokenCreated, AuditLog, AuthSession, ChatMessage, Conversation, CurrentUser, KnowledgeDocument, KnowledgeDocumentDetail, KnowledgeRetrievalAudit, LLMUsageBreakdown, LLMHealthBreakdown, LLMCheckResult, LLMConfig, LLMInvocationLog, McpDiscoveryResult, McpImportResult, MonitorStats, OpenAPIImportResult, OrganizationApiToken, OrganizationMemberUser, OrganizationRole, PlatformReadiness, RegressionQualityOverview, RunEvidence, RunIncidentSummary, RunRecovery, RunRetentionRequest, RunRetentionResult, RunTraceEvent, RuntimeState, Skill, SkillExportPackage, SkillHealth, SkillImpact, SkillImportPreview, SkillRuntimePreview, SkillVersion, SkillVersionDiff, ToolDefinition, ToolHealth, ToolInvocationAudit, ToolInvokeResult, ToolSecret, UploadQuota, UploadResult } from '../types/domain';

const jsonHeaders = { 'Content-Type': 'application/json' };
const TOKEN_KEY = 'agent_forge_access_token';

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function withAuthHeaders(headers?: HeadersInit): HeadersInit {
  const next = new Headers(headers || {});
  const token = getAccessToken();
  if (token) next.set('Authorization', `Bearer ${token}`);
  return next;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: withAuthHeaders(init?.headers) });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) clearAccessToken();
    throw new Error(readErrorMessage(detail) || `请求失败: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function readErrorMessage(detail: string) {
  if (!detail) return '';
  try {
    const parsed = JSON.parse(detail);
    if (typeof parsed?.detail === 'string') return parsed.detail;
    if (Array.isArray(parsed?.detail)) {
      return parsed.detail
        .map((item: { msg?: string; message?: string }) => item?.msg || item?.message)
        .filter(Boolean)
        .join('；');
    }
    if (typeof parsed?.message === 'string') return parsed.message;
  } catch {
    return detail;
  }
  return detail;
}

export const api = {
  login: async (payload: { email: string; password: string }) => {
    const session = await request<AuthSession>('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
    setAccessToken(session.access_token);
    return session;
  },
  me: () => request<CurrentUser>('/api/auth/me'),
  listOrganizationMembers: () => request<OrganizationMemberUser[]>('/api/auth/members'),
  createOrganizationMember: (payload: { email: string; display_name: string; password: string; role: OrganizationRole }) =>
    request<OrganizationMemberUser>('/api/auth/members', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  resetOrganizationMemberPassword: (id: string, payload: { password: string }) =>
    request<OrganizationMemberUser>(`/api/auth/members/${id}/password`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  updateOrganizationMember: (id: string, payload: { role?: OrganizationRole; status?: 'active' | 'disabled' }) =>
    request<OrganizationMemberUser>(`/api/auth/members/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(payload) }),
  listApiTokens: () => request<ApiToken[]>('/api/auth/tokens'),
  listOrganizationApiTokens: () => request<OrganizationApiToken[]>('/api/auth/org-tokens'),
  createApiToken: (payload: { name: string; expires_at?: string | null }) =>
    request<ApiTokenCreated>('/api/auth/tokens', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  revokeApiToken: (id: string) => request(`/api/auth/tokens/${id}`, { method: 'DELETE' }),
  revokeOrganizationApiToken: (id: string) => request(`/api/auth/org-tokens/${id}`, { method: 'DELETE' }),
  listAudits: (params?: { action?: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.action) search.set('action', params.action);
    search.set('limit', String(params?.limit || 100));
    return request<AuditLog[]>(`/api/audits?${search.toString()}`);
  },

  regressionQualityOverview: (params?: { limit?: number }) => {
    const search = new URLSearchParams();
    search.set('limit', String(params?.limit || 80));
    return request<RegressionQualityOverview>(`/api/quality/regression-overview?${search.toString()}`);
  },

  listAgents: () => request<Agent[]>('/api/agents'),
  createAgent: (payload: Partial<Agent>) =>
    request<Agent>('/api/agents', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  updateAgent: (id: string, payload: Partial<Agent>) =>
    request<Agent>(`/api/agents/${id}/draft`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(payload) }),
  publishAgent: (id: string) => request<Agent>(`/api/agents/${id}/publish`, { method: 'POST' }),
  enableAgentRelease: (id: string) => request<Agent>(`/api/agents/${id}/enable-release`, { method: 'POST' }),
  deactivateAgent: (id: string) => request<Agent>(`/api/agents/${id}/deactivate`, { method: 'POST' }),
  getAgentCompleteness: (id: string) => request<AgentCompleteness>(`/api/agents/${id}/completeness`),
  getAgentPreflight: (id: string) => request<AgentPreflight>(`/api/agents/${id}/preflight`),
  getAgentRegressionCoverage: (id: string) => request<AgentRegressionCoverage>(`/api/agents/${id}/regression-coverage`),
  getAgentRuntimeManifest: (id: string, source: 'draft' | 'release' = 'draft') =>
    request<AgentRuntimeManifestEnvelope>(`/api/agents/${id}/runtime-manifest?source=${source}`),
  previewAgentRuntimeManifest: (id: string, payload: Partial<Agent>) =>
    request<AgentRuntimeManifestEnvelope>(`/api/agents/${id}/runtime-manifest/preview`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  listAgentReleases: (id: string) => request<AgentReleaseSnapshot[]>(`/api/agents/${id}/releases`),
  deleteAgent: (id: string) => request(`/api/agents/${id}`, { method: 'DELETE' }),

  listLlms: () => request<LLMConfig[]>('/api/llms'),
  createLlm: (payload: Partial<LLMConfig>) =>
    request<LLMConfig>('/api/llms', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  updateLlm: (id: string, payload: Partial<LLMConfig>) =>
    request<LLMConfig>(`/api/llms/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(payload) }),
  checkLlm: (id: string) => request<LLMCheckResult>(`/api/llms/${id}/check`, { method: 'POST' }),
  deleteLlm: (id: string) => request(`/api/llms/${id}`, { method: 'DELETE' }),

  listSkills: () => request<Skill[]>('/api/skills'),
  listSkillsHealth: () => request<SkillHealth[]>('/api/skills/health'),
  getSkillHealth: (id: string) => request<SkillHealth>(`/api/skills/${id}/health`),
  createSkill: (payload: Partial<Skill>) =>
    request<Skill>('/api/skills', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  updateSkill: (id: string, payload: Partial<Skill>) =>
    request<Skill>(`/api/skills/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(payload) }),
  listSkillVersions: (id: string) => request<SkillVersion[]>(`/api/skills/${id}/versions`),
  publishSkillVersion: (id: string) => request<SkillVersion>(`/api/skills/${id}/versions`, { method: 'POST' }),
  restoreSkillVersion: (id: string, version: number) =>
    request<Skill>(`/api/skills/${id}/versions/${version}/restore`, { method: 'POST' }),
  getSkillRuntimePreview: (id: string) => request<SkillRuntimePreview>(`/api/skills/${id}/runtime-preview`),
  getSkillImpact: (id: string) => request<SkillImpact>(`/api/skills/${id}/impact`),
  previewSkillImport: (payload: { package: Record<string, unknown>; overwrite?: boolean; preserve_id?: boolean }) =>
    request<SkillImportPreview>('/api/skills/import/preview', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  diffSkillVersion: (id: string, version: number) => request<SkillVersionDiff>(`/api/skills/${id}/versions/${version}/diff`),
  exportSkill: (id: string) => request<SkillExportPackage>(`/api/skills/${id}/export`),
  importSkill: (payload: { package: Record<string, unknown>; overwrite?: boolean; preserve_id?: boolean }) =>
    request<Skill>('/api/skills/import', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  deleteSkill: (id: string) => request(`/api/skills/${id}`, { method: 'DELETE' }),

  listTools: () => request<ToolDefinition[]>('/api/tools'),
  listToolsHealth: () => request<ToolHealth[]>('/api/tools/health'),
  getToolHealth: (toolId: string) => request<ToolHealth>(`/api/tools/${toolId}/health`),
  createTool: (payload: Partial<ToolDefinition>) =>
    request<ToolDefinition>('/api/tools', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  updateTool: (toolId: string, payload: Partial<ToolDefinition>) =>
    request<ToolDefinition>(`/api/tools/${toolId}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(payload) }),
  deleteTool: (toolId: string) => request(`/api/tools/${toolId}`, { method: 'DELETE' }),
  invokeTool: (toolId: string, input: unknown) =>
    request<ToolInvokeResult>(`/api/tools/${toolId}/invoke`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ input }) }),
  importOpenApiTools: (payload: { spec: Record<string, unknown>; prefix?: string; category?: string; overwrite?: boolean; allow_private_networks?: boolean }) =>
    request<OpenAPIImportResult>('/api/tools/import/openapi', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  discoverMcpTools: (payload: { metadata: Record<string, unknown> }) =>
    request<McpDiscoveryResult>('/api/tools/mcp/discover', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  importMcpTools: (payload: { metadata: Record<string, unknown>; prefix?: string; category?: string; tool_names?: string[]; overwrite?: boolean }) =>
    request<McpImportResult>('/api/tools/import/mcp', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  listToolSecrets: () => request<ToolSecret[]>('/api/tools/secrets'),
  createToolSecret: (payload: Partial<ToolSecret> & { value: string }) =>
    request<ToolSecret>('/api/tools/secrets', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  updateToolSecret: (secretId: string, payload: Partial<ToolSecret> & { value?: string }) =>
    request<ToolSecret>(`/api/tools/secrets/${secretId}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(payload) }),
  deleteToolSecret: (secretId: string) => request(`/api/tools/secrets/${secretId}`, { method: 'DELETE' }),
  listToolAudits: (params?: {
    toolId?: string;
    runId?: string;
    source?: string;
    agentId?: string;
    conversationId?: string;
    limit?: number;
  }) => {
    const search = new URLSearchParams();
    if (params?.toolId) search.set('tool_id', params.toolId);
    if (params?.runId) search.set('run_id', params.runId);
    if (params?.source) search.set('source', params.source);
    if (params?.agentId) search.set('agent_id', params.agentId);
    if (params?.conversationId) search.set('conversation_id', params.conversationId);
    search.set('limit', String(params?.limit || 50));
    return request<ToolInvocationAudit[]>(`/api/tools/audits?${search.toString()}`);
  },
  listKnowledge: (agentId: string) => request<KnowledgeDocument[]>(`/api/knowledge/${agentId}`),
  getKnowledge: (documentId: string) => request<KnowledgeDocumentDetail>(`/api/knowledge/documents/${documentId}`),
  uploadKnowledge: async (agentId: string, file: File): Promise<KnowledgeDocument> => {
    const form = new FormData();
    form.append('file', file);
    return request<KnowledgeDocument>(`/api/knowledge/${agentId}`, { method: 'POST', body: form });
  },
  deleteKnowledge: (documentId: string) => request(`/api/knowledge/${documentId}`, { method: 'DELETE' }),

  listSessions: (agentId?: string) =>
    request<Conversation[]>(`/api/sessions${agentId ? `?agent_id=${agentId}` : ''}`),
  listMessages: (conversationId: string) => request<ChatMessage[]>(`/api/sessions/${conversationId}/messages`),
  deleteSession: (conversationId: string) => request(`/api/sessions/${conversationId}`, { method: 'DELETE' }),

  uploadFile: async (file: File, conversationId?: string): Promise<UploadResult> => {
    const form = new FormData();
    form.append('file', file);
    const suffix = conversationId ? `?conversation_id=${conversationId}` : '';
    return request<UploadResult>(`/api/uploads${suffix}`, { method: 'POST', body: form });
  },

  stats: () => request<MonitorStats>('/api/monitor/stats'),
  llmUsageBreakdown: () => request<LLMUsageBreakdown>('/api/monitor/llm-usage-breakdown'),
  llmHealthBreakdown: () => request<LLMHealthBreakdown>('/api/monitor/llm-health-breakdown'),
  readiness: () => request<PlatformReadiness>('/api/monitor/readiness'),
  runtimeState: () => request<RuntimeState>('/api/monitor/runtime-state'),
  uploadQuota: () => request<UploadQuota>('/api/monitor/upload-quota'),
  getRunRetention: () => request<RunRetentionResult>('/api/monitor/run-retention'),
  previewRunRetention: (payload: RunRetentionRequest) =>
    request<RunRetentionResult>('/api/monitor/run-retention/preview', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  applyRunRetention: (payload: RunRetentionRequest) =>
    request<RunRetentionResult>('/api/monitor/run-retention/apply', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  listRuns: (params?: { agentId?: string; status?: string; q?: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.agentId) search.set('agent_id', params.agentId);
    if (params?.status) search.set('status', params.status);
    if (params?.q) search.set('q', params.q);
    search.set('limit', String(params?.limit || 30));
    return request<AgentRun[]>(`/api/runs?${search.toString()}`);
  },
  runIncidents: (params?: { windowMinutes?: number; staleThresholdMinutes?: number; queueLimit?: number }) => {
    const search = new URLSearchParams();
    search.set('window_minutes', String(params?.windowMinutes || 1440));
    search.set('stale_threshold_minutes', String(params?.staleThresholdMinutes || 120));
    search.set('queue_limit', String(params?.queueLimit || 5));
    return request<RunIncidentSummary>(`/api/runs/incidents?${search.toString()}`);
  },
  getRun: (id: string) => request<AgentRun>(`/api/runs/${id}`),
  listRunEvents: (id: string) => request<RunTraceEvent[]>(`/api/runs/${id}/events`),
  getRunEvidence: (id: string) => request<RunEvidence>(`/api/runs/${id}/evidence`),
  getRunRecovery: (id: string, limit = 5) => request<RunRecovery>(`/api/runs/${id}/recovery?limit=${limit}`),
  createTestCaseFromRun: (id: string, payload?: { name?: string; expected_keywords?: string[]; max_duration_ms?: number | null }) =>
    request<AgentTestCase>(`/api/runs/${id}/test-case`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload || {}) }),
  listLlmInvocationLogs: (runId: string, limit = 50) =>
    request<LLMInvocationLog[]>(`/api/runs/${runId}/llm-logs?limit=${limit}`),
  listKnowledgeRetrievalAudits: (runId: string, limit = 50) =>
    request<KnowledgeRetrievalAudit[]>(`/api/runs/${runId}/knowledge-audits?limit=${limit}`),
  rerunRun: (id: string) => request<AgentRun>(`/api/runs/${id}/rerun`, { method: 'POST' }),
  cancelRun: (id: string) => request<AgentRun>(`/api/runs/${id}/cancel`, { method: 'POST' }),
  markStaleRuns: (params?: { olderThanMinutes?: number; limit?: number }) => {
    const search = new URLSearchParams();
    search.set('older_than_minutes', String(params?.olderThanMinutes || 120));
    search.set('limit', String(params?.limit || 100));
    return request<AgentRun[]>(`/api/runs/maintenance/mark-stale?${search.toString()}`, { method: 'POST' });
  },

  listTestCases: (agentId: string) => request<AgentTestCase[]>(`/api/test-cases/agents/${agentId}`),
  listTestRuns: (caseId: string) => request<AgentTestRun[]>(`/api/test-cases/${caseId}/runs`),
  listTestSuiteRuns: (agentId: string) => request<AgentTestSuiteRun[]>(`/api/test-cases/agents/${agentId}/suite-runs`),
  runPreviewTestSuite: (agentId: string) => request<AgentTestSuiteRun>(`/api/test-cases/agents/${agentId}/run-preview-all`, { method: 'POST' }),
  runReleaseTestSuite: (agentId: string) => request<AgentTestSuiteRun>(`/api/test-cases/agents/${agentId}/run-release-all`, { method: 'POST' }),
  createTestCase: (agentId: string, payload: Partial<AgentTestCase>) =>
    request<AgentTestCase>(`/api/test-cases/agents/${agentId}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  updateTestCase: (id: string, payload: Partial<AgentTestCase>) =>
    request<AgentTestCase>(`/api/test-cases/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(payload) }),
  runPreviewTestCase: (id: string) => request<AgentTestRun>(`/api/test-cases/${id}/run-preview`, { method: 'POST' }),
  runReleaseTestCase: (id: string) => request<AgentTestRun>(`/api/test-cases/${id}/run-release`, { method: 'POST' }),
  deleteTestCase: (id: string) => request(`/api/test-cases/${id}`, { method: 'DELETE' }),
};

export interface ResponsesStreamRequest {
  model: string;
  input: string;
  metadata?: Record<string, unknown>;
}

export interface ResponsesStreamEvent {
  type: string;
  data: any;
}

export function responseStreamErrorMessage(event: ResponsesStreamEvent, fallback = '服务执行失败') {
  const error = event.data?.response?.error;
  if (typeof error === 'string') return error || fallback;
  if (typeof error?.message === 'string') return error.message || fallback;
  if (typeof event.data?.error?.message === 'string') return event.data.error.message || fallback;
  if (typeof event.data?.message === 'string') return event.data.message || fallback;
  return fallback;
}

export async function streamResponses(
  payload: ResponsesStreamRequest,
  onEvent: (event: ResponsesStreamEvent) => void,
) {
  const response = await fetch('/v1/responses', {
    method: 'POST',
    headers: withAuthHeaders(jsonHeaders),
    body: JSON.stringify({
      model: payload.model,
      input: payload.input,
      stream: true,
      metadata: payload.metadata || undefined,
    }),
  });
  await readResponseStream(response, onEvent);
}

export async function streamAgentPreviewResponses(
  agentId: string,
  payload: ResponsesStreamRequest,
  onEvent: (event: ResponsesStreamEvent) => void,
) {
  const response = await fetch(`/api/agents/${agentId}/preview-responses`, {
    method: 'POST',
    headers: withAuthHeaders(jsonHeaders),
    body: JSON.stringify({
      model: payload.model,
      input: payload.input,
      stream: true,
      metadata: payload.metadata || undefined,
    }),
  });
  await readResponseStream(response, onEvent);
}

async function readResponseStream(
  response: Response,
  onEvent: (event: ResponsesStreamEvent) => void,
) {
  if (!response.ok || !response.body) {
    const detail = await response.text();
    if (response.status === 401) clearAccessToken();
    throw new Error(readErrorMessage(detail) || `请求失败: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const raw of events) {
      const typeLine = raw.split('\n').find((line) => line.startsWith('event: '));
      const dataLines = raw
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.replace('data: ', ''));
      if (!typeLine || !dataLines.length || dataLines[0] === '[DONE]') continue;
      onEvent({
        type: typeLine.replace('event: ', ''),
        data: JSON.parse(dataLines.join('\n')),
      });
    }
  }
}
