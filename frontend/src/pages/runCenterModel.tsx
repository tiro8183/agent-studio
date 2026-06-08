import { Badge } from '@/components/ui/badge';
import { productTerms, runtimeActorLabel, visibleRuntimeText } from '../services/productLanguage';
import type {
  AgentRun,
  KnowledgeRetrievalAudit,
  LLMInvocationLog,
  OrganizationRole,
  RunIncidentItem,
  RunRecovery,
  RunRecoveryDelta,
  RunRecoverySnapshot,
  RunTraceEvent,
  ToolInvocationAudit,
} from '../types/domain';

export const runStatusMeta: Record<string, { label: string; color: 'success' | 'error' | 'processing' | 'default' | 'warning' }> = {
  completed: { label: '成功', color: 'success' },
  failed: { label: '失败', color: 'error' },
  blocked: { label: '已阻断', color: 'error' },
  running: { label: '运行中', color: 'processing' },
  cancelled: { label: '已取消', color: 'warning' },
  stale: { label: '超时', color: 'error' },
};

export const phaseLabels: Record<RunTraceEvent['phase'], string> = {
  setup: '准备',
  reasoning: '模型',
  tool: productTerms.action,
  subagent: productTerms.workRole,
  output: '整理',
  complete: '完成',
  error: '异常',
};

export const traceStatusLabels: Record<RunTraceEvent['status'], string> = {
  pending: '等待',
  running: '运行中',
  success: '成功',
  error: '错误',
  info: '信息',
};

export const roleLabels: Record<OrganizationRole, string> = {
  viewer: '观察者',
  editor: '编辑者',
  admin: '管理员',
  owner: '所有者',
};

export const recoveryStatusMeta: Record<RunRecovery['status'], { label: string; color: 'success' | 'processing' | 'warning' | 'default' }> = {
  recovered: { label: '已恢复', color: 'success' },
  verifying: { label: '验证中', color: 'processing' },
  unresolved: { label: '未恢复', color: 'warning' },
  not_rerun: { label: '未重跑', color: 'default' },
};

export const runtimeSourceMeta: Record<string, { label: string; color?: string }> = {
  preview: { label: '当前配置验证', color: 'gold' },
  release: { label: productTerms.releaseVersion, color: 'blue' },
  snapshot: { label: '配置快照', color: 'cyan' },
  publish: { label: '上线生成', color: 'geekblue' },
};

export const entrypointMeta: Record<string, { label: string; color?: string }> = {
  responses: { label: '主执行协议', color: 'blue' },
  chat_completions: { label: '历史兼容入口', color: 'default' },
};

export const runSourceMeta: Record<string, { label: string; color?: string }> = {
  runtime: { label: '业务调用', color: 'green' },
  test_case: { label: '验收用例', color: 'orange' },
  test_case_preview: { label: '配置验收', color: 'gold' },
  test_case_release: { label: '上线版本回归', color: 'blue' },
  rerun: { label: '重跑', color: 'cyan' },
  preview: { label: '当前配置验证', color: 'gold' },
};

export const entrypointProtocolMeta: Record<string, { name: string; path: string; note: string; role: string; evidence: string }> = {
  responses: {
    name: 'Responses',
    path: 'POST /v1/responses',
    role: '主执行协议',
    note: '验证台、SDK 和外部业务系统共用同一执行语义',
    evidence: '写入统一运行证据',
  },
  chat_completions: {
    name: '历史兼容调用',
    path: 'POST /v1/chat/completions',
    role: '历史兼容入口',
    note: '历史兼容请求会被平台收敛到 POST /v1/responses，并写入同一运行证据',
    evidence: '写入统一运行证据',
  },
  test_case: {
    name: '验收执行',
    path: 'POST /api/test-cases',
    role: '控制面触发',
    note: '由验收用例触发，执行结果仍回到同一证据链',
    evidence: '写入统一运行证据',
  },
  test_case_preview: {
    name: '配置验收',
    path: 'POST /api/test-cases/{id}/run-preview',
    role: '控制面触发',
    note: 'Agent Studio 上线前验证当前配置，复用统一执行语义',
    evidence: '写入统一运行证据',
  },
  test_case_release: {
    name: '上线版本回归',
    path: 'POST /api/test-cases/{id}/run-release',
    role: '控制面触发',
    note: `按${productTerms.releaseVersion}执行回归，复用统一执行语义`,
    evidence: '写入统一运行证据',
  },
  rerun: {
    name: '快照重跑',
    path: 'POST /api/runs/{id}/rerun',
    role: '恢复验证',
    note: '复用原配置快照与输入进行恢复验证',
    evidence: '写入统一运行证据',
  },
};

export const runTriggerProtocolMeta: Record<string, { name: string; path: string; note: string; role: string; evidence: string }> = {
  runtime: {
    name: '业务调用',
    path: 'POST /v1/responses',
    role: '执行面入口',
    note: '外部业务系统、SDK 和内部验证共用标准协议',
    evidence: '写入统一运行证据',
  },
  preview: {
    name: '当前配置验证',
    path: 'POST /v1/responses',
    role: '内部客户端',
    note: 'Agent Studio 内部验证也走标准执行协议',
    evidence: '保留业务输入、输出与运行轨迹',
  },
  test_case: {
    name: '验收用例',
    path: 'POST /api/test-cases',
    role: '控制面触发',
    note: '由控制面发起，但执行仍进入同一 Runtime',
    evidence: '生成可回归的运行证据',
  },
  test_case_preview: {
    name: '配置验收',
    path: 'POST /api/test-cases/{id}/run-preview',
    role: '控制面触发',
    note: '上线前验证当前配置，执行语义与正式入口一致',
    evidence: '生成上线前证据',
  },
  test_case_release: {
    name: '版本回归',
    path: 'POST /api/test-cases/{id}/run-release',
    role: '控制面触发',
    note: `按${productTerms.releaseVersion}执行回归验证`,
    evidence: '生成版本回归证据',
  },
  rerun: {
    name: '复验运行',
    path: 'POST /api/runs/{id}/rerun',
    role: '恢复验证',
    note: '按原上线版本和输入复核异常是否可恢复',
    evidence: '生成派生运行证据',
  },
};

export type RunTabKey = 'diagnosis' | 'trace' | 'io' | 'audit';
export type EvidenceIndexKey = 'output' | 'trace' | 'tools' | 'llm' | 'knowledge';

export function isOrganizationRole(value?: string | null): value is OrganizationRole {
  return value === 'viewer' || value === 'editor' || value === 'admin' || value === 'owner';
}

export function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value || 0);
}

export function formatDuration(value?: number | null) {
  if (!value) return '-';
  if (value < 1000) return `${value} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} 秒`;
  return `${Math.floor(value / 60000)} 分 ${Math.round((value % 60000) / 1000)} 秒`;
}

export function shortHash(value?: string | null) {
  return value ? value.slice(0, 12) : '-';
}

export function shortRunId(value?: string | null) {
  if (!value) return '-';
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

export function shortCallId(value?: string | null) {
  if (!value) return '-';
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

export function shortAuditUser(value?: string | null) {
  if (!value) return '系统';
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

// Badge variant helpers mapping from antd colors to new Badge variants
function runStatusVariant(status: string): 'success' | 'destructive' | 'info' | 'warning' | 'muted' | 'outline' {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'blocked' || status === 'stale') return 'destructive';
  if (status === 'running') return 'info';
  if (status === 'cancelled') return 'warning';
  return 'outline';
}

function runtimeSourceVariant(source?: string): 'default' | 'info' | 'warning' | 'outline' {
  if (source === 'release') return 'info';
  if (source === 'preview' || source === 'publish') return 'warning';
  return 'outline';
}

function entrypointVariant(entrypoint?: string): 'default' | 'info' | 'outline' {
  if (entrypoint === 'responses') return 'info';
  return 'outline';
}

function runSourceVariant(source?: string): 'success' | 'warning' | 'info' | 'default' | 'outline' {
  if (source === 'runtime') return 'success';
  if (source === 'test_case_release') return 'info';
  if (source === 'test_case' || source === 'test_case_preview' || source === 'preview') return 'warning';
  if (source === 'rerun') return 'default';
  return 'outline';
}

export function runStatusTag(status: string) {
  const meta = runStatusMeta[status] || { label: status || '-', color: 'default' as const };
  return <Badge variant={runStatusVariant(status)}>{meta.label}</Badge>;
}

export function releaseTag(run: AgentRun) {
  const meta = runtimeSourceMeta[run.runtime_source || ''] || { label: run.runtime_source || '存量记录' };
  if (run.release_id && run.runtime_source === 'release') {
    return <Badge variant="info">上线版本 v{run.agent_version || 1}</Badge>;
  }
  return <Badge variant={runtimeSourceVariant(run.runtime_source)}>{meta.label}</Badge>;
}

export function entrypointTag(run: AgentRun) {
  const meta = entrypointMeta[run.entrypoint || ''] || { label: run.entrypoint || '未知入口' };
  return <Badge variant={entrypointVariant(run.entrypoint)}>{meta.label}</Badge>;
}

export function runSourceTag(run: AgentRun) {
  const meta = runSourceMeta[run.run_source || ''] || { label: run.run_source || '运行' };
  return <Badge variant={runSourceVariant(run.run_source)}>{meta.label}</Badge>;
}

export function incidentSeverityColor(severity: RunIncidentItem['severity']) {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'warning';
  return 'default';
}

export function incidentSeverityVariant(severity: RunIncidentItem['severity']): 'destructive' | 'warning' | 'outline' {
  if (severity === 'critical') return 'destructive';
  if (severity === 'warning') return 'warning';
  return 'outline';
}

export function incidentQueueStatus(key: string) {
  if (key === 'blocked') return 'blocked';
  if (key === 'failed') return 'failed';
  if (key === 'stale') return 'stale';
  if (key === 'cancelled') return 'cancelled';
  return undefined;
}

export function eventText(value: unknown) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export function llmContractItems(event: RunTraceEvent) {
  const contracts = (event.metadata || {}).contracts;
  return Array.isArray(contracts)
    ? contracts.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
}

export function llmUsageBreakdownItems(event: RunTraceEvent) {
  const breakdown = (event.metadata || {}).breakdown;
  return Array.isArray(breakdown)
    ? breakdown.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
}

export function llmActorLabel(record: LLMInvocationLog) {
  return runtimeActorLabel(record.runtime_scope, record.subagent_name);
}

export function llmActorTagColor(record: LLMInvocationLog) {
  return record.runtime_scope === 'subagent' || record.subagent_name ? 'blue' : 'default';
}

export function llmActorVariant(record: LLMInvocationLog): 'info' | 'outline' {
  return record.runtime_scope === 'subagent' || record.subagent_name ? 'info' : 'outline';
}

export function eventTone(event: RunTraceEvent) {
  if (event.phase === 'error' || event.status === 'error') return 'danger';
  if (event.phase === 'complete' || event.status === 'success') return 'success';
  if (event.phase === 'tool') return 'tool';
  if (event.phase === 'subagent') return 'handoff';
  return 'neutral';
}

function eventPhaseVariant(event: RunTraceEvent): 'destructive' | 'success' | 'default' | 'info' | 'muted' {
  if (event.phase === 'error' || event.status === 'error') return 'destructive';
  if (event.phase === 'complete' || event.status === 'success') return 'success';
  if (event.phase === 'tool') return 'default';
  if (event.phase === 'subagent') return 'info';
  if (event.phase === 'output') return 'muted';
  return 'muted';
}

function eventStatusVariant(event: RunTraceEvent): 'success' | 'destructive' | 'outline' {
  if (event.status === 'success') return 'success';
  if (event.status === 'error') return 'destructive';
  return 'outline';
}

function eventDisplayLabel(event: RunTraceEvent, index: number) {
  if (event.phase === 'reasoning') return '模型响应';
  if (event.phase === 'tool') return `${productTerms.action}调用`;
  if (event.phase === 'subagent') return runtimeActorLabel('subagent', event.subagent);
  if (event.type === 'knowledge_retrieval' || event.resource === 'knowledge') return `${productTerms.businessMaterial}召回`;
  if (event.phase === 'complete') return '完成';
  if (event.phase === 'error' || event.status === 'error') return '异常';
  return visibleRuntimeText(event.label) || phaseLabels[event.phase] || `事件 ${index + 1}`;
}

export function renderEvent(event: RunTraceEvent, index: number) {
  const input = eventText(event.input ?? event.input_preview);
  const output = eventText(event.output ?? event.output_preview);
  const resource = eventText(event.resource);
  const subagent = eventText(event.subagent);
  const task = eventText(event.task);
  const callId = eventText(event.call_id);
  const llmContracts = event.type === 'llm_contracts' ? llmContractItems(event) : [];
  const llmUsageBreakdown = event.type === 'llm_usage' ? llmUsageBreakdownItems(event) : [];
  const tone = eventTone(event);

  return (
    <article className={`rounded-lg border p-3 space-y-2 ${
      tone === 'danger' ? 'border-destructive/40 bg-destructive/5' :
      tone === 'success' ? 'border-success/30 bg-success/5' :
      tone === 'tool' ? 'border-primary/20 bg-primary/5' :
      tone === 'handoff' ? 'border-info/30 bg-info/5' :
      'border-border bg-card'
    }`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground font-mono">#{event.seq || index + 1}</span>
        <Badge variant={eventPhaseVariant(event)}>{phaseLabels[event.phase] || event.phase}</Badge>
        <strong className="text-sm font-medium">{eventDisplayLabel(event, index)}</strong>
        {resource && <Badge variant="outline">{visibleRuntimeText(resource)}</Badge>}
        <Badge variant={eventStatusVariant(event)}>{traceStatusLabels[event.status] || event.status}</Badge>
        {event.duration_ms > 0 && <Badge variant="info">{formatDuration(event.duration_ms)}</Badge>}
        {event.parent_seq && <Badge variant="muted">关联 #{event.parent_seq}</Badge>}
      </div>
      <div className="space-y-1.5 text-sm">
        {subagent && <span className="text-muted-foreground">{productTerms.workRole}：{subagent}</span>}
        {task && <p className="text-foreground">{task}</p>}
        {llmContracts.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {llmContracts.map((item, contractIndex) => (
              <div key={`${String(item.scope || 'scope')}-${String(item.subagent || contractIndex)}-${String(item.model || contractIndex)}`}
                className="rounded border border-border bg-muted/40 px-2.5 py-1.5">
                <strong className="block text-xs font-semibold">{String(item.model || '-')}</strong>
                <span className="text-xs text-muted-foreground">
                  {runtimeActorLabel(String(item.scope || 'main'), item.subagent ? String(item.subagent) : undefined)}
                  {' · '}
                  {String(item.llm_name || item.llm_config_id || '-')}
                </span>
              </div>
            ))}
          </div>
        )}
        {llmUsageBreakdown.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {llmUsageBreakdown.map((item, usageIndex) => (
              <div key={`${String(item.subagent || 'main')}-${String(item.model || usageIndex)}`}
                className="rounded border border-border bg-muted/40 px-2.5 py-1.5">
                <strong className="block text-xs font-semibold">{formatNumber(Number(item.total_tokens || 0))}</strong>
                <span className="text-xs text-muted-foreground">
                  {runtimeActorLabel(item.subagent ? 'subagent' : 'main', item.subagent ? String(item.subagent) : undefined)}
                  {' · '}
                  {String(item.model || '-')}
                  {' · '}
                  {formatNumber(Number(item.input_tokens || 0))}/{formatNumber(Number(item.output_tokens || 0))} · {formatNumber(Number(item.llm_calls || 0))} 次
                </span>
              </div>
            ))}
          </div>
        )}
        {input && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">输入</summary>
            <pre className="mt-1 rounded bg-muted/60 p-2 text-xs overflow-x-auto">{input}</pre>
          </details>
        )}
        {output && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">输出</summary>
            <pre className="mt-1 rounded bg-muted/60 p-2 text-xs overflow-x-auto">{output}</pre>
          </details>
        )}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1 border-t border-border/50">
          {callId && <small>调用 {shortCallId(callId)}</small>}
          {event.step_id && event.step_id !== callId && <small>步骤证据 {event.step_id}</small>}
          {event.elapsed_ms > 0 && <small>开始后 {formatDuration(event.elapsed_ms)}</small>}
          {event.timestamp && <small>{formatDate(event.timestamp)}</small>}
        </div>
      </div>
    </article>
  );
}

export function runSummary(run: AgentRun) {
  const events = run.events || [];
  const errorEvents = events.filter((event) => event.phase === 'error' || event.status === 'error').length;

  return [
    { label: productTerms.agentService, value: run.agent_name || run.agent_id },
    { label: '状态', value: runStatusMeta[run.status]?.label || run.status },
    { label: '发起时间', value: formatDate(run.started_at) },
    { label: '耗时', value: run.status === 'running' ? '运行中' : formatDuration(run.duration_ms) },
    { label: '失败原因', value: run.error || (errorEvents ? `${errorEvents} 个异常事件` : '无') },
    { label: '建议处置', value: run.status === 'running' ? '观察或取消' : (run.input_text || run.input_preview ? '复验或沉淀样本' : '查看证据') },
  ];
}

export function manifestSummary(run: AgentRun) {
  const manifest = run.runtime_manifest;
  if (!manifest) return null;
  return {
    backend: manifest.backend_type,
    checkpointing: manifest.checkpointing ? '开启' : '关闭',
    debug: manifest.debug ? '开启' : '关闭',
    mainTools: manifest.main_tools.length,
    mainSkills: manifest.main_skills.length,
    subagents: manifest.subagents.length,
    warnings: manifest.warnings.map((item) => `风险提示：${visibleRuntimeText(item)}`),
    missing: [
      ...manifest.missing_tools.map((item) => `${productTerms.failedItem}：缺失${productTerms.action} ${item}`),
      ...manifest.missing_skills.map((item) => `${productTerms.failedItem}：缺失${productTerms.capabilityPackage} ${item}`),
    ],
  };
}

export function runLlmContracts(run: AgentRun | null) {
  const event = (run?.events || []).find((item) => item.type === 'llm_contracts');
  return event ? llmContractItems(event) : [];
}

export function auditSourceLabel(value?: string | null) {
  if (value === 'manual') return '手动验证';
  if (value === 'runtime') return '运行时';
  if (value === 'test') return '验收测试';
  if (value === 'system') return '系统';
  return value || '未知';
}

export function auditSourceColor(value?: string | null) {
  if (value === 'manual') return 'processing';
  if (value === 'runtime') return 'blue';
  if (value === 'test') return 'purple';
  return 'default';
}

export function auditSourceVariant(value?: string | null): 'info' | 'default' | 'outline' {
  if (value === 'manual') return 'info';
  if (value === 'runtime') return 'info';
  if (value === 'test') return 'default';
  return 'outline';
}

export function auditSummary(record: ToolInvocationAudit) {
  return record.error || record.response_preview || record.request_preview || '-';
}

export function traceEventEvidenceText(event: RunTraceEvent) {
  return eventText(
    event.output
    ?? event.output_preview
    ?? event.input
    ?? event.input_preview
    ?? event.metadata?.error
    ?? event.label,
  );
}

export function failureEvidenceItems(events: RunTraceEvent[], run?: AgentRun | null) {
  const traceFailures = events
    .filter((event) => event.phase === 'error' || event.status === 'error')
    .map((event) => ({
      key: `${event.seq || event.step_id || event.timestamp}-failure`,
      seq: event.seq || 0,
      phase: phaseLabels[event.phase] || event.phase,
      label: visibleRuntimeText(event.label || event.type || '异常事件'),
      resource: visibleRuntimeText(eventText(event.resource || event.subagent)),
      callId: eventText(event.call_id),
      timestamp: event.timestamp,
      message: traceEventEvidenceText(event) || '没有记录详细错误信息',
    }));

  if (!traceFailures.length && run?.error) {
    return [{
      key: `${run.id}-run-error`,
      seq: 0,
      phase: '运行',
      label: '运行失败',
      resource: '',
      callId: '',
      timestamp: run.ended_at || run.started_at,
      message: run.error,
    }];
  }

  return traceFailures;
}

export function subagentHandoffItems(events: RunTraceEvent[]) {
  return events
    .filter((event) => event.phase === 'subagent' || Boolean(event.subagent) || String(event.type || '').includes('subagent'))
    .map((event) => {
      const metadata = event.metadata || {};
      return {
        key: `${event.seq || event.step_id || event.timestamp}-handoff`,
        seq: event.seq || 0,
        parentSeq: event.parent_seq || 0,
        from: eventText(metadata.handoff_from) || '主 Agent',
        to: eventText(metadata.handoff_to) || event.subagent || event.resource || productTerms.workRole,
        task: event.task || eventText(metadata.task) || event.input_preview || '',
        input: eventText(event.input ?? event.input_preview),
        output: eventText(event.output ?? event.output_preview),
        callId: eventText(event.call_id),
        durationMs: event.duration_ms || 0,
        status: event.status,
        timestamp: event.timestamp,
      };
    });
}


export function toolAuditSummary(records: ToolInvocationAudit[]) {
  const failed = records.filter((item) => item.status === 'failed' || item.error);
  const slowest = records.reduce<ToolInvocationAudit | null>((current, item) => (
    !current || (item.duration_ms || 0) > (current.duration_ms || 0) ? item : current
  ), null);
  return {
    total: records.length,
    failed: failed.length,
    slowest,
  };
}

export function llmLogSummary(records: LLMInvocationLog[]) {
  return records.reduce(
    (summary, record) => {
      const calls = record.llm_calls || 0;
      const actor = llmActorLabel(record);
      const actorKey = `${actor}|${record.model || '-'}`;
      const actorItem = summary.actors.get(actorKey) || {
        actor,
        model: record.model || '-',
        calls: 0,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        failures: 0,
      };
      actorItem.calls += calls;
      actorItem.tokens += record.total_tokens || 0;
      actorItem.inputTokens += record.input_tokens || 0;
      actorItem.outputTokens += record.output_tokens || 0;
      actorItem.failures += record.status === 'failed' || record.error ? 1 : 0;
      summary.actors.set(actorKey, actorItem);
      return {
        calls: summary.calls + calls,
        tokens: summary.tokens + (record.total_tokens || 0),
        inputTokens: summary.inputTokens + (record.input_tokens || 0),
        outputTokens: summary.outputTokens + (record.output_tokens || 0),
        failures: summary.failures + (record.status === 'failed' || record.error ? 1 : 0),
        firstToken: summary.firstToken || record.first_token_ms || 0,
        actors: summary.actors,
      };
    },
    {
      calls: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      failures: 0,
      firstToken: 0,
      actors: new Map<string, {
        actor: string;
        model: string;
        calls: number;
        tokens: number;
        inputTokens: number;
        outputTokens: number;
        failures: number;
      }>(),
    },
  );
}

export function knowledgeAuditSummary(records: KnowledgeRetrievalAudit[]) {
  return records.reduce(
    (summary, record) => ({
      indexed: summary.indexed + (record.indexed_chunks || 0),
      retrieved: summary.retrieved + (record.retrieved_chunks || 0),
      sources: new Set([...summary.sources, record.index_source || 'unknown']),
    }),
    { indexed: 0, retrieved: 0, sources: new Set<string>() },
  );
}

function signedNumber(value: number, suffix = '') {
  if (!value) return `0${suffix}`;
  return `${value > 0 ? '+' : ''}${formatNumber(value)}${suffix}`;
}

export function recoverySnapshotLabel(snapshot?: RunRecoverySnapshot | null) {
  if (!snapshot) return '-';
  return `${runStatusMeta[snapshot.status]?.label || snapshot.status} · ${formatDate(snapshot.started_at)}`;
}

export function recoveryDeltaItems(deltas: RunRecoveryDelta) {
  return [
    { label: '耗时', value: signedNumber(deltas.duration_ms, 'ms') },
    { label: '首响应', value: signedNumber(deltas.first_token_ms, 'ms') },
    { label: 'Token', value: signedNumber(deltas.total_tokens) },
    { label: '模型调用', value: signedNumber(deltas.llm_calls) },
  ];
}

export function statusDomainLabel(run?: AgentRun | null, failureLabel?: string) {
  if (!run) return '未选择运行';
  if (run.status === 'running') return '执行中';
  if (run.status === 'completed') return '交付结果';
  if (run.status === 'cancelled') return '人工中止';
  if (run.status === 'stale') return '运行超时';
  return failureLabel || run.error || '失败待定位';
}

export function runNextActionLabel(run?: AgentRun | null, failureDetail?: { phase: string; label: string; message: string } | null) {
  if (!run) return '先选择一条运行记录';
  if (run.status === 'running') return '观察时长，必要时终止现场';
  if (run.status === 'completed') return '复核交付结果，沉淀验收样本';
  if (run.status === 'cancelled') return '确认中止原因，必要时按原版本复验';
  if (run.status === 'stale') return '标记超时后按原版本复验';
  if (failureDetail?.phase) return `先看${failureDetail.phase}阶段证据`;
  return '先定位错误事件，再复验';
}
