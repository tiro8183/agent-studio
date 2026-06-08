import type { Agent } from '../types/domain';

export type AgentLifecycleTone = 'success' | 'warning' | 'muted';

export const agentLifecycleMeta: Record<Agent['status'], { label: string; color: string; tone: AgentLifecycleTone }> = {
  unpublished: { label: '未上线', color: 'warning', tone: 'warning' },
  published: { label: '已上线', color: 'success', tone: 'success' },
  inactive: { label: '停用', color: 'default', tone: 'muted' },
};

export function agentLifecycleLabel(status?: Agent['status'] | string | null) {
  if (!status) return '-';
  return agentLifecycleMeta[status as Agent['status']]?.label || status;
}

export function agentConfigStateLabel(agent: Agent | null, hasUnsavedChanges: boolean, hasPendingPublish: boolean) {
  if (!agent) return hasUnsavedChanges ? '服务配置待保存' : '等待填写服务配置';
  if (hasUnsavedChanges) return '配置待保存';
  if (agent.status === 'unpublished') return '未上线';
  if (agent.status === 'published' && !agent.latest_release_spec_hash) return '上线版本缺失';
  if (agent.status === 'inactive' && hasPendingPublish) return '停用 · 配置变更待上线';
  if (agent.status === 'inactive' && agent.latest_release_spec_hash) return '停用 · 可重新上线';
  if (agent.status === 'inactive') return '停用';
  if (hasPendingPublish) return '配置变更待上线';
  return '已上线';
}

export function agentReleaseStateLabel(agent: Agent | null, hasPendingPublish: boolean) {
  if (!agent) return '尚未生成上线版本';
  if (agent.status === 'unpublished') return '尚未生成上线版本';
  if (agent.status === 'inactive') return hasPendingPublish ? '服务停用，待重新上线' : '上线版本已停用';
  if (!agent.latest_release_spec_hash) return '上线版本缺失';
  return hasPendingPublish ? '配置变更待上线' : '上线版本一致';
}

export function agentStudioObjectLabel(agent: Agent | null) {
  if (!agent) return '未保存';
  return agentLifecycleLabel(agent.status);
}

export function agentStudioObjectDetail(agent: Agent | null, hasUnsavedChanges: boolean, hasPendingPublish: boolean) {
  if (!agent) {
    return hasUnsavedChanges ? '保存后进入未上线状态' : '先定义服务身份、模型通道和执行标准';
  }
  if (hasUnsavedChanges) {
    if (agent.status === 'unpublished') return '配置待保存；保存后仍为未上线';
    if (agent.status === 'inactive') return '配置待保存；服务仍为停用';
    if (!agent.latest_release_spec_hash) return '配置待保存；当前没有可用上线版本';
    return '配置待保存；线上仍使用当前上线版本';
  }
  if (agent.status === 'unpublished') return '配置已保存，完成检查和验收后即可上线';
  if (agent.status === 'inactive') {
    return hasPendingPublish ? '服务已停用，配置变更需重新上线' : '服务已停用，可在检查通过后重新上线';
  }
  return hasPendingPublish ? '配置已保存，线上仍使用上一版快照' : '线上版本与当前配置一致';
}

export function agentReleaseLabel(agent: Agent | null, hasPendingPublish = false) {
  if (!agent) return '无上线版本';
  if (agent.status === 'unpublished') return '无上线版本';
  if (agent.status === 'inactive') {
    if (!agent.latest_release_spec_hash) return '已停用 · 无上线版本';
    if (hasPendingPublish) return `已停用 · v${agent.version || 1} 待重新上线`;
    return `已停用 · 可启用 v${agent.version || 1}`;
  }
  if (!agent.latest_release_spec_hash) return '上线版本缺失';
  return hasPendingPublish ? `线上 v${agent.version || 1} · 配置变更待上线` : `线上 v${agent.version || 1}`;
}
