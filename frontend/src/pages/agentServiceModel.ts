import { productTerms } from '../services/productLanguage';
import type { Agent, AgentReleaseSnapshot } from '../types/domain';

export interface ServiceProfile {
  scenario: string;
  output: string;
  collaboration: string;
  actionScope: string;
  domain: string;
  department: string;
  maturity: string;
  usageHint: string;
  trialCases: string[];
  dataScope: string;
  riskLabel: string;
  resourceLabel: string;
  releaseText: string;
  serviceOwner: string;
  sla: string;
  callerScope: string;
  changeWindow: string;
  governance: string;
  displayTags: string[];
  versionLabel: string;
  releaseSpecHash: string;
  hasPendingPublish: boolean;
  integrationPolicy: string;
  approvalStatus: string;
  supportContact: string;
  dataClassification: string;
  riskLevel: string;
  healthLabel: string;
  catalogGaps: string[];
  catalogCompleteness: number;
  integrationReady: boolean;
}

export function shortHash(value?: string | null) {
  return value ? value.slice(0, 12) : '-';
}

export function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export interface ServiceDirectoryEntry {
  agent: Agent;
  release?: AgentReleaseSnapshot;
}

export function serviceAgentFromRelease(agent: Agent, release?: AgentReleaseSnapshot): Agent {
  if (!release?.agent_spec) return agent;
  const spec = release.agent_spec;
  return {
    ...agent,
    ...spec,
    id: agent.id,
    org_id: agent.org_id,
    slug: agent.slug,
    status: agent.status,
    version: release.version,
    published_at: agent.published_at,
    current_spec_hash: agent.current_spec_hash,
    latest_release_spec_hash: release.spec_hash,
    config_pending_publish: agent.config_pending_publish,
    created_at: agent.created_at,
    updated_at: agent.updated_at,
  };
}

export function serviceProfile(entry: Agent | ServiceDirectoryEntry): ServiceProfile {
  const agent = 'agent' in entry ? serviceAgentFromRelease(entry.agent, entry.release) : entry;
  const release = 'agent' in entry ? entry.release : undefined;
  const toolCount = agent.tools.length;
  const skillCount = agent.skills.length;
  const knowledgeCount = agent.memory.length;
  const resourceCount = toolCount + skillCount + knowledgeCount + agent.subagents.length;
  const output = agent.output.mode === 'json_schema' ? '结构化交付物' : '按服务说明输出';
  const collaboration = agent.subagents.length ? `${agent.subagents.length} 个${productTerms.workRole}` : '独立运行';
  const writeEnabled = agent.permissions.allow_write;
  const catalog = serviceCatalog(agent);
  const trialCases = catalog.trial_cases.length
    ? catalog.trial_cases.filter((item) => item.trim()).slice(0, 5)
    : catalog.sample_prompts.filter((item) => item.trim()).slice(0, 5);
  const integrationPolicy = catalog.integration_policy || '需维护接入策略';
  const approvalStatus = catalog.approval_status || '待确认';
  const supportContact = catalog.support_contact || catalog.owner || '支持联系人待完善';
  const dataClassification = catalog.data_classification || '数据分级待完善';
  const riskLevel = catalog.risk_level || (writeEnabled ? '需复核' : '常规');
  const healthLabel = catalog.health_status || (agent.status === 'published' && !agent.config_pending_publish ? '可用' : '待复核');
  const requiredCatalogFields = [
    ['业务域', catalog.domain],
    ['归属团队', catalog.department],
    ['维护人', catalog.owner],
    ['支持方式', catalog.service_level],
    ['调用范围', catalog.caller_scope],
    ['接入策略', catalog.integration_policy],
    ['数据分级', catalog.data_classification],
  ] as const;
  const catalogGaps = requiredCatalogFields.filter(([, value]) => !value).map(([label]) => label);
  const catalogCompleteness = Math.round(((requiredCatalogFields.length - catalogGaps.length) / requiredCatalogFields.length) * 100);
  const integrationReady = agent.status === 'published'
    && !agent.config_pending_publish
    && catalogGaps.length === 0
    && !['待确认', '暂停接入', '禁止接入'].includes(approvalStatus);
  const displayTags = [
    catalog.department,
    writeEnabled ? '授权写入' : '只读处理',
    output,
    collaboration,
  ].filter(Boolean);
  return {
    scenario: agent.description || '尚未补充适用场景',
    output,
    collaboration,
    actionScope: writeEnabled ? '授权写入' : '只读处理',
    domain: catalog.domain || '业务域待完善',
    department: catalog.department || '归属待完善',
    maturity: agent.published_at ? '已上线' : '待补充上线记录',
    usageHint: writeEnabled ? '适合有明确授权边界的业务处理' : '适合资料阅读、摘要和复核',
    trialCases,
    dataScope: knowledgeCount
      ? `已接入 ${knowledgeCount} 份${productTerms.businessMaterial}`
      : agent.filesystem.enabled
        ? '使用会话与工作区上下文'
        : '仅使用会话输入',
    riskLabel: writeEnabled ? '写入工具需复核' : '只读处理',
    resourceLabel: resourceCount ? `${resourceCount} 项运行依赖` : '基础运行',
    releaseText: agent.published_at ? formatDate(agent.published_at) : '上线时间未记录',
    serviceOwner: catalog.owner || '维护人待完善',
    sla: catalog.service_level || '支持方式待完善',
    callerScope: catalog.caller_scope || '按组织权限使用',
    changeWindow: agent.config_pending_publish ? '配置变更待上线' : '上线版本已冻结',
    governance: writeEnabled ? '运行结果可追踪，写入工具按策略复核' : '运行结果可追踪，不改写业务数据',
    displayTags,
    versionLabel: `v${release?.version || agent.version || 1}`,
    releaseSpecHash: release?.spec_hash || agent.latest_release_spec_hash || '',
    hasPendingPublish: Boolean(('agent' in entry ? entry.agent : agent).config_pending_publish),
    integrationPolicy,
    approvalStatus,
    supportContact,
    dataClassification,
    riskLevel,
    healthLabel,
    catalogGaps,
    catalogCompleteness,
    integrationReady,
  };
}

function serviceCatalog(agent: Agent) {
  const metadata = agent.metadata || {};
  const raw = metadata.service_catalog;
  const catalog = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  return {
    domain: textValue(catalog.domain),
    department: textValue(catalog.department),
    owner: textValue(catalog.owner),
    service_level: textValue(catalog.service_level),
    caller_scope: textValue(catalog.caller_scope),
    integration_policy: textValue(catalog.integration_policy),
    approval_status: textValue(catalog.approval_status),
    support_contact: textValue(catalog.support_contact),
    data_classification: textValue(catalog.data_classification),
    risk_level: textValue(catalog.risk_level),
    health_status: textValue(catalog.health_status),
    sample_prompts: Array.isArray(catalog.sample_prompts)
      ? catalog.sample_prompts.map((item) => textValue(item)).filter(Boolean)
      : [],
    trial_cases: Array.isArray(catalog.trial_cases)
      ? catalog.trial_cases.map((item) => textValue(item)).filter(Boolean)
      : [],
  };
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function formatRuntimeError(value?: string) {
  const message = value || '';
  if (message.includes('401') || message.toLowerCase().includes('invalid token')) {
    return '模型通道未通过：当前通道来源返回鉴权异常。运行证据已保存，请管理员在模型通道页重新检测密钥和权限。';
  }
  return message || '运行失败，请查看运行证据。';
}

export function navigateTo(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('popstate'));
}

export function goRuns() {
  navigateTo('/runs');
}

export function goStudio() {
  navigateTo('/agents');
}

export function goExperience(agentId?: string, prompt?: string) {
  if (agentId) sessionStorage.setItem('agent_forge_experience_agent', agentId);
  if (prompt) sessionStorage.setItem('agent_forge_experience_prompt', prompt);
  navigateTo('/experience');
}
