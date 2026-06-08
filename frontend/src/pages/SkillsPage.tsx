import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tag } from 'antd';
import { AlertTriangle, Brain, GitBranch, PackageCheck, ShieldCheck, Wrench } from 'lucide-react';
import { WorkspaceIssueList, WorkspaceMetricGrid, WorkspacePage } from '../components/ui';
import { api } from '../services/api';
import { workspaceApi } from '../services/workspaceApi';
import { summarizeSkillGovernance } from './assetGovernanceModel';
import { SkillManagement } from './admin/SkillManagement';

export default function SkillsPage() {
  const tools = useQuery({ queryKey: ['tools'], queryFn: api.listTools });
  const skills = useQuery({ queryKey: ['skills'], queryFn: api.listSkills });
  const skillHealth = useQuery({ queryKey: ['skill-health'], queryFn: api.listSkillsHealth });
  const workspace = useQuery({ queryKey: ['workspace', 'asset-governance'], queryFn: workspaceApi.assetGovernance });
  const toolOptions = useMemo(
    () => (tools.data || []).map((item) => ({
      value: item.id,
      label: `${item.name} · ${item.description}`,
    })),
    [tools.data],
  );
  const summary = useMemo(
    () => summarizeSkillGovernance(skills.data || [], skillHealth.data || []),
    [skillHealth.data, skills.data],
  );

  return (
    <WorkspacePage
      icon={<Brain size={14} />}
      eyebrow="资产治理"
      title="Skills"
      description="治理可复用的 Skill 指令、allowed tools、版本记录和线上影响，确保进入 Agent Runtime 后行为一致。"
    >
      <section className="surface page-surface asset-workspace-summary">
        <div className="surface-header">
          <div>
            <h2>Skill 治理状态</h2>
            <p>后端统一返回 Skill allowed tools、Runtime 影响范围与治理风险，前端不再自行复算运行真相。</p>
          </div>
        </div>
        <WorkspaceMetricGrid items={workspace.data?.metrics || []} />
        <WorkspaceIssueList items={(workspace.data?.issues || []).filter((item) => item.key.startsWith('skill:'))} emptyLabel="当前没有 Skill 未通过项。" />
      </section>
      <section className="asset-ledger governance-ledger" aria-label="Skill governance state">
        <span className={`asset-ledger-badge ${summary.tone}`}>{summary.label}</span>
          <div className={summary.blockers ? 'danger' : summary.warnings ? 'warning' : 'ready'}>
            {summary.blockers ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
            <span>上线检查</span>
            <strong>{summary.blockers}</strong>
            <em>{summary.warnings} 个风险提示</em>
          </div>
          <div className={summary.publishedServices ? 'warning' : 'ready'}>
            <PackageCheck size={15} />
            <span>线上影响</span>
            <strong>{summary.publishedServices}</strong>
            <em>已上线 Agent 引用</em>
          </div>
          <div>
            <GitBranch size={15} />
            <span>绑定范围</span>
            <strong>{summary.boundServices}</strong>
            <em>主流程与协作角色</em>
          </div>
          <div>
            <Wrench size={15} />
            <span>Skill allowed tools</span>
            <strong>{summary.allowedActions}</strong>
            <em>allowed tool refs</em>
          </div>
        <footer>
          <Tag>执行规范</Tag>
          <Tag>Skill allowed tools</Tag>
          <Tag>运行预览</Tag>
          <Tag>版本记录</Tag>
          <Tag>影响范围</Tag>
        </footer>
      </section>
      <SkillManagement toolOptions={toolOptions} />
    </WorkspacePage>
  );
}
