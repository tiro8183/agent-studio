import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tag } from 'antd';
import { AlertTriangle, Brain, GitBranch, PackageCheck, ShieldCheck, Wrench } from 'lucide-react';
import { WorkspacePage } from '../components/ui';
import { api } from '../services/api';
import { summarizeSkillGovernance } from './assetGovernanceModel';
import { SkillManagement } from './admin/SkillManagement';

export default function SkillsPage() {
  const tools = useQuery({ queryKey: ['tools'], queryFn: api.listTools });
  const skills = useQuery({ queryKey: ['skills'], queryFn: api.listSkills });
  const skillHealth = useQuery({ queryKey: ['skill-health'], queryFn: api.listSkillsHealth });
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
      eyebrow="能力包资产"
      title="能力包资产"
      description="治理可复用的执行规范、允许工具、版本记录和线上影响，确保进入 Agent 后行为一致。"
    >
      <section className="asset-ledger governance-ledger" aria-label="能力包资产治理状态">
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
            <span>允许工具</span>
            <strong>{summary.allowedActions}</strong>
            <em>允许工具引用</em>
          </div>
        <footer>
          <Tag>执行规范</Tag>
          <Tag>允许工具</Tag>
          <Tag>运行预览</Tag>
          <Tag>版本记录</Tag>
          <Tag>影响范围</Tag>
        </footer>
      </section>
      <SkillManagement toolOptions={toolOptions} />
    </WorkspacePage>
  );
}
