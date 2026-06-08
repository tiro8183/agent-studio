import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, Network, ShieldCheck, Wrench } from 'lucide-react';
import { WorkspaceMetricGrid, WorkspacePage, StatusSummary } from '../components/ui';
import { SectionCard } from '../components/layout';
import { Badge } from '../components/ui/badge';
import { api } from '../services/api';
import { workspaceApi } from '../services/workspaceApi';
import { summarizeToolGovernance } from './assetGovernanceModel';
import { ToolManagement } from './admin/ToolManagement';

export default function ToolsPage() {
  const tools = useQuery({ queryKey: ['tools'], queryFn: api.listTools });
  const toolHealth = useQuery({ queryKey: ['tool-health'], queryFn: api.listToolsHealth });
  const toolSecrets = useQuery({ queryKey: ['tool-secrets'], queryFn: api.listToolSecrets });
  const toolAudits = useQuery({ queryKey: ['tool-audits'], queryFn: () => api.listToolAudits({ limit: 30 }) });
  const workspace = useQuery({ queryKey: ['workspace', 'asset-governance'], queryFn: workspaceApi.assetGovernance });

  const summary = useMemo(
    () => summarizeToolGovernance(tools.data || [], toolHealth.data || [], toolSecrets.data || [], toolAudits.data || []),
    [toolAudits.data, toolHealth.data, toolSecrets.data, tools.data],
  );

  return (
    <WorkspacePage
      icon={<Wrench size={14} />}
      eyebrow="资产治理"
      title="Tools"
      description="治理 Agent 可调用的 Tools，确认谁能用、能访问哪里、最近是否跑通、影响哪些已上线 Agents 或 Skills。"
    >
      <SectionCard
        title="Tool 治理状态"
        description="后端聚合 Tool 未通过项、运行证据和 Skill allowed tools 影响范围。"
      >
        <WorkspaceMetricGrid items={workspace.data?.metrics || []} />
      </SectionCard>

      <StatusSummary
        ariaLabel="Tool governance state"
        badge={summary.label}
        badgeTone={summary.tone}
        title="Tool 运行真相"
        items={[
          {
            icon: <AlertTriangle className="size-4" />,
            label: '上线检查',
            value: summary.blockers,
            detail: `${summary.warnings} 个风险提示`,
            tone: summary.blockers ? 'blocked' : summary.warnings ? 'warning' : 'ready',
          },
          {
            icon: <Network className="size-4" />,
            label: 'Tools',
            value: `${summary.active}/${summary.total}`,
            detail: `HTTP ${summary.implementationBreakdown.http} · MCP ${summary.implementationBreakdown.mcp} · 内置 ${summary.implementationBreakdown.builtin}`,
          },
          {
            icon: <KeyRound className="size-4" />,
            label: '授权凭据',
            value: summary.configuredSecrets,
            detail: '只引用，不回显明文',
          },
          {
            icon: <ShieldCheck className="size-4" />,
            label: '运行证据',
            value: summary.failedEvidence,
            detail: '最近 30 条失败',
            tone: summary.failedEvidence ? 'blocked' : 'ready',
          },
        ]}
        footer={
          <>
            <Badge variant="muted">Tool Definition</Badge>
            <Badge variant="muted">授权与边界</Badge>
            <Badge variant="muted">连通测试</Badge>
            <Badge variant="muted">运行证据</Badge>
            <Badge variant="muted">使用方</Badge>
          </>
        }
      />

      <ToolManagement />
    </WorkspacePage>
  );
}
