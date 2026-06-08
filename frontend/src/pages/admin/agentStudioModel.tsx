import { Tag } from 'antd';
import type {
  Agent,
  AgentPreflightCheck,
  AgentRegressionCase,
  AgentTestAssertion,
  LLMConfig,
} from '../../types/domain';
import { agentLifecycleMeta } from '../../services/agentLifecycle';

export const agentStatusMeta: Record<Agent['status'], { label: string; color: string }> = {
  unpublished: agentLifecycleMeta.unpublished,
  published: agentLifecycleMeta.published,
  inactive: agentLifecycleMeta.inactive,
};

export const deepAgentBuiltinTools = [
  { value: 'execute', label: 'execute · 受控执行 Tool' },
  { value: 'task', label: 'task · Subagent 调度' },
  { value: 'write_todos', label: 'write_todos · 任务规划' },
  { value: 'ls', label: 'ls · 资料目录读取' },
  { value: 'read_file', label: 'read_file · 业务资料读取' },
  { value: 'write_file', label: 'write_file · 业务资料写入' },
  { value: 'edit_file', label: 'edit_file · 业务资料修订' },
  { value: 'glob', label: 'glob · 资料范围匹配' },
  { value: 'grep', label: 'grep · 资料内容检索' },
];

export const runtimeEventOptions = [
  { value: 'run_started', label: '运行开始' },
  { value: 'model_invoked', label: '模型调用' },
  { value: 'tool_called', label: 'Tool call' },
  { value: 'tool_result', label: 'Tool result' },
  { value: 'subagent', label: 'Subagent call' },
  { value: 'subagent_result', label: 'Subagent result' },
  { value: 'skills', label: 'Skills' },
  { value: 'memory', label: 'Memory' },
  { value: 'knowledge', label: '业务资料' },
  { value: 'knowledge_retrieval', label: '业务资料召回' },
  { value: 'llm_contracts', label: '模型运行合约' },
  { value: 'llm_usage', label: '模型用量' },
  { value: 'run_completed', label: '运行完成' },
  { value: 'run_blocked', label: '运行阻断' },
];

export const emptyAssertion: AgentTestAssertion = {
  required_keywords: [],
  required_tools: [],
  required_subagents: [],
  required_event_types: [],
  required_json_schema: {},
  max_duration_ms: null,
};

export const preflightGroupMeta = {
  identity: '身份',
  runtime: '执行引擎',
  model: '模型',
  resources: '依赖',
  evaluation: '验收',
  operations: '运行',
};

export const preflightGroupOrder: AgentPreflightCheck['group'][] = [
  'identity',
  'runtime',
  'model',
  'resources',
  'evaluation',
  'operations',
];

export const studioSteps = [
  { key: 'profile', group: '定义', label: '身份', title: 'Agent Profile', target: 'studio-profile', desc: '名称、场景、模型通道' },
  { key: 'model', group: '合约', label: '模型', title: '模型合约', target: 'studio-model', desc: '通道、模型、调用参数' },
  { key: 'instructions', group: '定义', label: '标准', title: '执行标准', target: 'studio-instructions', desc: '职责、边界、输出要求' },
  { key: 'capabilities', group: '运行', label: '编排', title: 'Runtime Composition', target: 'studio-capabilities', desc: 'Tools、Skills、Memory' },
  { key: 'subagents', group: '运行', label: '协作', title: 'Subagents', target: 'studio-subagents', desc: '岗位、任务、专业边界' },
  { key: 'knowledge', group: '资料', label: '资料', title: '业务资料', target: 'studio-knowledge', desc: '资料、引用依据' },
  { key: 'runtime', group: '策略', label: '策略', title: '运行策略', target: 'studio-runtime', desc: '访问范围、确认机制' },
  { key: 'evaluation', group: '上线', label: '验收', title: '上线验收', target: 'studio-evaluation', desc: '场景、标准、结果' },
] as const;

export type StudioStepKey = typeof studioSteps[number]['key'];

export function defaultAgent(firstLlm?: LLMConfig) {
  return {
    name: '',
    slug: '',
    description: '',
    system_prompt: '',
    llm_config_id: firstLlm?.id,
    model: firstLlm?.default_model,
    engine_mode: 'deepagents',
    tools: [],
    skills: [],
    subagents: [],
    memory: [],
    filesystem: { enabled: true, mode: 'virtual', read_only: false },
    permissions: { allow_write: true, allowed_paths: ['/workspace/**', '/skills/**'] },
    runtime: { backend_type: 'filesystem', debug: false, checkpointing: false, interrupt_on: {} },
    interrupt_tools: [],
    output: { mode: 'text', json_schema: {} },
    harness: { excluded_tools: [], tool_description_overrides: {}, disable_general_purpose_subagent: false },
    metadata: {
      service_catalog: {
        domain: '',
        department: '',
        owner: '',
        service_level: '',
        caller_scope: '',
        sample_prompts: [],
      },
    },
    model_override: {},
    routing: { fixed_replies: [] },
    context_config: { max_rounds: 20 },
    max_iterations: 8,
    status: 'unpublished',
  };
}

export function agentContractPayloadFromForm(
  values: Record<string, any>,
  outputSchemaText = '{}',
  harnessToolDescriptionText = '{}',
) {
  const outputSchema = JSON.parse(outputSchemaText || '{}');
  const toolDescriptionOverrides = JSON.parse(harnessToolDescriptionText || '{}');
  return {
    ...values,
    runtime: {
      ...(values.runtime || {}),
      interrupt_on: Object.fromEntries((values.interrupt_tools || []).map((item: string) => [item, true])),
    },
    subagents: (values.subagents || []).map((subagent: any) => ({
      ...subagent,
      interrupt_on: Object.fromEntries((subagent.interrupt_tools || []).map((item: string) => [item, true])),
      interrupt_tools: undefined,
      output: {
        ...(subagent.output || {}),
        json_schema: JSON.parse(subagent.output?.schema_text || '{}'),
        schema_text: undefined,
      },
    })),
    interrupt_tools: undefined,
    output: {
      ...(values.output || {}),
      json_schema: outputSchema,
    },
    harness: {
      ...(values.harness || {}),
      tool_description_overrides: toolDescriptionOverrides,
    },
  };
}

export function mergeAssertion(assertion?: Partial<AgentTestAssertion>, expectedKeywords: string[] = []) {
  return {
    ...emptyAssertion,
    ...(assertion || {}),
    required_keywords: assertion?.required_keywords?.length ? assertion.required_keywords : expectedKeywords,
  };
}

export function shortHash(value?: string | null) {
  return value ? value.slice(0, 12) : '-';
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let next = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && next >= 1024; index += 1) {
    next /= 1024;
    unit = units[index];
  }
  return `${next >= 10 ? next.toFixed(1) : next.toFixed(2)} ${unit}`;
}

export function isCurrentTestCase(item: { last_runtime_plan_hash?: string | null }, currentHash?: string) {
  return Boolean(currentHash && item.last_runtime_plan_hash && item.last_runtime_plan_hash === currentHash);
}

export function testCaseFreshness(item: { last_status: string; last_runtime_plan_hash?: string | null }, currentHash?: string) {
  if (item.last_status === 'untested') return { label: '未运行', color: 'default' as const };
  if (isCurrentTestCase(item, currentHash)) return { label: '当前配置', color: 'success' as const };
  return { label: '配置已变更', color: 'warning' as const };
}

const testRunStatusMeta: Record<string, { label: string; color: 'success' | 'error' | 'processing' | 'default' }> = {
  passed: { label: '通过', color: 'success' },
  failed: { label: '失败', color: 'error' },
  error: { label: '异常', color: 'error' },
  running: { label: '运行中', color: 'processing' },
};

export function testRunStatusTag(status: string) {
  const meta = testRunStatusMeta[status] || { label: status || '-', color: 'default' as const };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

const regressionFreshnessMeta: Record<AgentRegressionCase['freshness'], { label: string; color: 'success' | 'warning' | 'default' | 'processing' }> = {
  current: { label: '当前配置', color: 'success' },
  stale: { label: '配置已变更', color: 'warning' },
  untested: { label: '未运行', color: 'default' },
  inactive: { label: '停用', color: 'default' },
};

export function regressionResultTag(status: AgentRegressionCase['result_status']) {
  return testRunStatusTag(status);
}

export function regressionFreshnessTag(freshness: AgentRegressionCase['freshness']) {
  const meta = regressionFreshnessMeta[freshness];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

export function renderPreflightEvidence(check: AgentPreflightCheck) {
  const entries = Object.entries(check.evidence || {}).filter(([, value]) => (
    value !== undefined && value !== null && value !== ''
  ));
  if (!entries.length) return null;
  return (
    <dl className="evidence-list">
      {entries.slice(0, 6).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
