export const productTerms = {
  agentService: 'Agent',
  tool: 'Tool',
  action: 'Tool',
  systemAction: 'Tool',
  skill: 'Skill',
  capabilityPackage: 'Skill',
  workRole: 'Subagent',
  businessMaterial: '知识资料',
  failedItem: '未通过项',
  riskNotice: '风险提示',
  runtimeEngine: 'Runtime',
  runtimeManifest: 'Runtime Manifest',
  runtimeTools: 'Runtime Tools',
  releaseVersion: 'Release',
};

export function runtimeActorLabel(scope?: string | null, name?: string | null) {
  if (scope === 'subagent' || name) return `${productTerms.workRole}：${name || '未命名'}`;
  if (scope === 'mixed') return '混合路径';
  return '主流程';
}

export function auditSubjectLabel(value: string) {
  const normalized = value.replace(/[_:/]/g, '.').toLowerCase();
  if (normalized.includes('login')) return '登录';
  if (normalized.includes('token')) return '访问令牌';
  if (normalized.includes('llm')) return '模型通道';
  if (normalized.includes('tool')) return productTerms.action;
  if (normalized.includes('agent')) return productTerms.agentService;
  if (normalized.includes('skill')) return productTerms.skill;
  if (normalized.includes('member') || normalized.includes('user')) return '成员';
  return value;
}

export function visibleRuntimeText(value?: string | null) {
  if (!value) return value || '';
  const exactMap: Record<string, string> = {
    已发布版本: productTerms.releaseVersion,
    协作角色: productTerms.workRole,
    知识文件: productTerms.businessMaterial,
    知识召回: `${productTerms.businessMaterial}召回`,
    工具审计: `${productTerms.action} 调用证据`,
    工具调用: `${productTerms.action} 调用`,
    工具失败: `${productTerms.action} 调用失败`,
    缺失工具: `缺失 ${productTerms.action}`,
    未启用工具: `未启用 ${productTerms.action}`,
    缺失能力: `缺失 ${productTerms.skill}`,
    未启用能力: `未启用 ${productTerms.skill}`,
    缺失能力包: `缺失 ${productTerms.skill}`,
    未启用能力包: `未启用 ${productTerms.skill}`,
    阻断: '未通过',
    blocker: productTerms.failedItem,
    warning: productTerms.riskNotice,
  };
  const normalized = value.trim();
  return exactMap[normalized] || value;
}
