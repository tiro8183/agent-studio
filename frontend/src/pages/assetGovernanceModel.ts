import type { Skill, SkillHealth, ToolDefinition, ToolHealth, ToolInvocationAudit, ToolSecret } from '../types/domain';

export type GovernanceTone = 'blocked' | 'warning' | 'ready' | 'empty';

export type ToolGovernanceSummary = {
  active: number;
  blockers: number;
  configuredSecrets: number;
  failedEvidence: number;
  implementationBreakdown: {
    builtin: number;
    http: number;
    mcp: number;
  };
  label: string;
  tone: GovernanceTone;
  total: number;
  warnings: number;
};

export type SkillGovernanceSummary = {
  active: number;
  allowedActions: number;
  blockers: number;
  boundServices: number;
  label: string;
  publishedServices: number;
  tone: GovernanceTone;
  total: number;
  warnings: number;
};

export function governanceLabel(tone: GovernanceTone) {
  if (tone === 'blocked') return '待处理';
  if (tone === 'warning') return '需复核';
  if (tone === 'ready') return '可上线';
  return '待接入';
}

export function summarizeToolGovernance(
  tools: ToolDefinition[],
  health: ToolHealth[],
  secrets: ToolSecret[],
  audits: ToolInvocationAudit[],
): ToolGovernanceSummary {
  const blockers = health.reduce((sum, item) => sum + item.blockers, 0);
  const warnings = health.reduce((sum, item) => sum + item.warnings, 0);
  const failedEvidence = audits.filter((item) => item.status !== 'success').length;
  const tone: GovernanceTone = blockers || failedEvidence ? 'blocked' : warnings ? 'warning' : tools.length ? 'ready' : 'empty';

  return {
    active: tools.filter((tool) => tool.status === 'active').length,
    blockers,
    configuredSecrets: secrets.filter((secret) => secret.configured).length,
    failedEvidence,
    implementationBreakdown: {
      builtin: tools.filter((tool) => tool.implementation === 'builtin').length,
      http: tools.filter((tool) => tool.implementation === 'http').length,
      mcp: tools.filter((tool) => tool.implementation === 'mcp').length,
    },
    label: governanceLabel(tone),
    tone,
    total: tools.length,
    warnings,
  };
}

export function summarizeSkillGovernance(skills: Skill[], health: SkillHealth[]): SkillGovernanceSummary {
  const blockers = health.reduce((sum, item) => sum + item.blockers, 0);
  const warnings = health.reduce((sum, item) => sum + item.warnings, 0);
  const tone: GovernanceTone = blockers ? 'blocked' : warnings ? 'warning' : skills.length ? 'ready' : 'empty';

  return {
    active: skills.filter((skill) => skill.status === 'active').length,
    allowedActions: skills.reduce((sum, item) => sum + (item.allowed_tools?.length || 0), 0),
    blockers,
    boundServices: health.reduce((sum, item) => sum + item.bound_agents, 0),
    label: governanceLabel(tone),
    publishedServices: health.reduce((sum, item) => sum + item.published_agents, 0),
    tone,
    total: skills.length,
    warnings,
  };
}
