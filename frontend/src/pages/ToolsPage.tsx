import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tag } from 'antd';
import { AlertTriangle, KeyRound, Network, ShieldCheck, Wrench } from 'lucide-react';
import { WorkspacePage } from '../components/ui';
import { api } from '../services/api';
import { summarizeToolGovernance } from './assetGovernanceModel';
import { ToolManagement } from './admin/ToolManagement';

export default function ToolsPage() {
  const tools = useQuery({ queryKey: ['tools'], queryFn: api.listTools });
  const toolHealth = useQuery({ queryKey: ['tool-health'], queryFn: api.listToolsHealth });
  const toolSecrets = useQuery({ queryKey: ['tool-secrets'], queryFn: api.listToolSecrets });
  const toolAudits = useQuery({ queryKey: ['tool-audits'], queryFn: () => api.listToolAudits({ limit: 30 }) });

  const summary = useMemo(
    () => summarizeToolGovernance(tools.data || [], toolHealth.data || [], toolSecrets.data || [], toolAudits.data || []),
    [toolAudits.data, toolHealth.data, toolSecrets.data, tools.data],
  );

  return (
    <WorkspacePage
      icon={<Wrench size={14} />}
      eyebrow="工具治理"
      title="工具治理"
      description="治理 Agent 可调用的外部工具，确认谁能用、能访问哪里、最近是否跑通、影响哪些已上线 Agent。"
    >
      <section className="asset-ledger governance-ledger" aria-label="工具治理状态">
        <span className={`asset-ledger-badge ${summary.tone}`}>{summary.label}</span>
        <div className={summary.blockers ? 'danger' : summary.warnings ? 'warning' : 'ready'}>
            <AlertTriangle size={15} />
            <span>上线检查</span>
            <strong>{summary.blockers}</strong>
            <em>{summary.warnings} 个风险提示</em>
          </div>
          <div>
            <Network size={15} />
            <span>工具资产</span>
            <strong>{summary.active}/{summary.total}</strong>
            <em>HTTP {summary.implementationBreakdown.http} · MCP {summary.implementationBreakdown.mcp} · 内置 {summary.implementationBreakdown.builtin}</em>
          </div>
          <div>
            <KeyRound size={15} />
            <span>授权凭据</span>
            <strong>{summary.configuredSecrets}</strong>
            <em>只引用，不回显明文</em>
          </div>
          <div className={summary.failedEvidence ? 'danger' : 'ready'}>
            <ShieldCheck size={15} />
            <span>运行证据</span>
            <strong>{summary.failedEvidence}</strong>
            <em>最近 30 条失败</em>
          </div>
        <footer>
          <Tag>工具定义</Tag>
          <Tag>授权与边界</Tag>
          <Tag>连通测试</Tag>
          <Tag>运行证据</Tag>
          <Tag>使用方</Tag>
        </footer>
      </section>
      <ToolManagement />
    </WorkspacePage>
  );
}
