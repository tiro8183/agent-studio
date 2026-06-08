import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Brain, GitBranch, PackageCheck, ShieldCheck, Wrench } from 'lucide-react';
import { WorkspaceIssueList, WorkspaceMetricGrid, WorkspacePage, StatusSummary } from '../components/ui';
import { SectionCard } from '../components/layout';
import { Badge } from '../components/ui/badge';
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
      <SectionCard
        title="Skill 治理状态"
        description="后端统一返回 Skill allowed tools、Runtime 影响范围与治理风险，前端不再自行复算运行真相。"
      >
        <div className="space-y-4">
          <WorkspaceMetricGrid items={workspace.data?.metrics || []} />
          <WorkspaceIssueList
            items={(workspace.data?.issues || []).filter((item) => item.key.startsWith('skill:'))}
            emptyLabel="当前没有 Skill 未通过项。"
          />
        </div>
      </SectionCard>

      <StatusSummary
        ariaLabel="Skill governance state"
        badge={summary.label}
        badgeTone={summary.tone}
        title="Skill 运行真相"
        items={[
          {
            icon: summary.blockers ? <AlertTriangle className="size-4" /> : <ShieldCheck className="size-4" />,
            label: '上线检查',
            value: summary.blockers,
            detail: `${summary.warnings} 个风险提示`,
            tone: summary.blockers ? 'blocked' : summary.warnings ? 'warning' : 'ready',
          },
          {
            icon: <PackageCheck className="size-4" />,
            label: '线上影响',
            value: summary.publishedServices,
            detail: '已上线 Agent 引用',
            tone: summary.publishedServices ? 'warning' : 'ready',
          },
          {
            icon: <GitBranch className="size-4" />,
            label: '绑定范围',
            value: summary.boundServices,
            detail: '主流程与协作角色',
          },
          {
            icon: <Wrench className="size-4" />,
            label: 'Skill allowed tools',
            value: summary.allowedActions,
            detail: 'allowed tool refs',
          },
        ]}
        footer={
          <>
            <Badge variant="muted">执行规范</Badge>
            <Badge variant="muted">Skill allowed tools</Badge>
            <Badge variant="muted">运行预览</Badge>
            <Badge variant="muted">版本记录</Badge>
            <Badge variant="muted">影响范围</Badge>
          </>
        }
      />

      <SkillManagement toolOptions={toolOptions} />
    </WorkspacePage>
  );
}
