import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Tag } from 'antd';
import {
  ArrowRight,
  Boxes,
  Braces,
  ClipboardCheck,
  Compass,
  Copy,
  DatabaseZap,
  FileSearch,
  PenLine,
  PlayCircle,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { api } from '../services/api';
import { canAtLeast } from '../services/authz';
import type { AgentRun, AssetGovernanceItem, WorkspaceAgentSummary, WorkspaceMetric } from '../types/domain';
import type { WorkspacePageContext } from './pageContext';
import { navigateTo } from './agentServiceModel';

const runStatusLabel: Record<AgentRun['status'], { label: string; color: string }> = {
  completed: { label: '成功', color: 'success' },
  failed: { label: '失败', color: 'error' },
  running: { label: '运行中', color: 'processing' },
  cancelled: { label: '已取消', color: 'warning' },
  stale: { label: '超时', color: 'error' },
  blocked: { label: '已阻断', color: 'error' },
};

function metricValue(metrics: WorkspaceMetric[] | undefined, key: string) {
  return metrics?.find((item) => item.key === key)?.value || '0';
}

function assetIssueCount(items: AssetGovernanceItem[] | undefined) {
  return (items || []).filter((item) => item.blockers || item.warnings).length;
}

function formatDuration(value?: number | null) {
  if (!value) return '-';
  if (value < 1000) return `${value} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} 秒`;
  return `${Math.floor(value / 60000)} 分 ${Math.round((value % 60000) / 1000)} 秒`;
}

function agentState(agent: WorkspaceAgentSummary) {
  if (agent.catalog_ready) return { label: '可接入', color: 'success' };
  if (agent.blockers) return { label: '上线检查未通过', color: 'error' };
  if (agent.config_pending_publish) return { label: '变更待发布', color: 'warning' };
  if (agent.status === 'published') return { label: '已上线', color: 'success' };
  if (agent.status === 'inactive') return { label: '已停用', color: 'default' };
  return { label: '草稿', color: 'processing' };
}

function copyText(value: string) {
  if (!value) return;
  navigator.clipboard?.writeText(value).catch(() => {
    // Clipboard availability depends on the browser shell; copying is optional.
  });
}

export default function WorkspaceHomePage({ currentUser }: WorkspacePageContext) {
  const command = useQuery({ queryKey: ['workspace', 'command-center'], queryFn: api.workspaceCommandCenter });
  const studio = useQuery({ queryKey: ['workspace', 'agent-studio', 'home'], queryFn: api.workspaceAgentStudio });
  const assets = useQuery({ queryKey: ['workspace', 'asset-governance', 'home'], queryFn: api.workspaceAssetGovernance });
  const runs = useQuery({ queryKey: ['workspace', 'run-evidence', 'home'], queryFn: () => api.workspaceRunEvidence({ limit: 4 }) });
  const canEdit = canAtLeast(currentUser?.membership.role, 'editor');

  const agents = studio.data?.agents || command.data?.priority_agents || [];
  const publishedAgents = agents.filter((agent) => agent.status === 'published' && !agent.config_pending_publish);
  const apiReadyAgents = publishedAgents.filter((agent) => agent.catalog_ready);
  const blockedAgents = agents.filter((agent) => agent.blockers || agent.config_pending_publish || agent.status !== 'published');
  const primaryAgent = apiReadyAgents[0] || publishedAgents[0] || agents[0];
  const runsData = runs.data?.runs || [];
  const assetIssues = assetIssueCount(assets.data?.providers) + assetIssueCount(assets.data?.tools) + assetIssueCount(assets.data?.skills);
  const topAgents = useMemo(() => {
    const selected = [...apiReadyAgents, ...blockedAgents.filter((agent) => !apiReadyAgents.some((item) => item.id === agent.id))];
    return selected.slice(0, 4);
  }, [apiReadyAgents, blockedAgents]);

  const deliverySteps = [
    {
      title: '设计 Agent 服务',
      body: '在 Agent Studio 中定义服务边界、模型通道、Subagent、知识资料、Skills 和 Tools。',
      icon: PenLine,
      target: '/agents',
      action: '进入 Agent Studio',
    },
    {
      title: '通过发布门禁',
      body: 'Preflight、Runtime Manifest、回归用例和配置差异共同决定能否上线。',
      icon: ShieldCheck,
      target: '/quality',
      action: '查看发布门禁',
    },
    {
      title: '开放标准 API',
      body: '上线后的 Agent 以 model=agent:<service_slug> 暴露给外部系统调用。',
      icon: Braces,
      target: '/services',
      action: '查看服务目录',
    },
    {
      title: '沉淀运行证据',
      body: '体验验证、外部调用、Tool 调用、LLM Trace 和错误复验进入同一证据链。',
      icon: FileSearch,
      target: '/runs',
      action: '查看运行证据',
    },
  ] as const;

  const foundationItems = [
    { label: '模型通道', value: assets.data?.providers.length || 0, issue: assetIssueCount(assets.data?.providers), icon: DatabaseZap, target: '/providers' },
    { label: 'Tools', value: assets.data?.tools.length || 0, issue: assetIssueCount(assets.data?.tools), icon: Wrench, target: '/tools' },
    { label: 'Skills', value: assets.data?.skills.length || 0, issue: assetIssueCount(assets.data?.skills), icon: Boxes, target: '/skills' },
  ] as const;

  return (
    <div className="page workspace-home-page forge-home-page">
      <section className="forge-home-hero">
        <div className="forge-home-hero-copy">
          <div className="eyebrow"><Compass size={14} /> Agent Forge 首页</div>
          <h1>把 Agent 做成可上线、可调用、可追责的业务服务。</h1>
          <p>
            Agent Forge 面向国内团队的 Agent 服务生产平台：从 Agent Studio 设计服务，到发布门禁冻结 Release，再通过 `POST /v1/responses`
            给外部系统开放 API，并用 Run Evidence 保留完整证据链。
          </p>
          <div className="forge-home-hero-actions">
            <Button type="primary" icon={<PenLine size={15} />} disabled={!canEdit} onClick={() => navigateTo('/agents')}>开始构建 Agent</Button>
            <Button icon={<Compass size={15} />} onClick={() => navigateTo('/services')}>查看 Agent 服务目录</Button>
            <Button icon={<PlayCircle size={15} />} onClick={() => navigateTo('/experience')}>体验验证</Button>
          </div>
        </div>

        <aside className="forge-home-contract" aria-label="标准 API 合约">
          <div className="forge-contract-topline">
            <span>标准调用协议</span>
            <Tag color={apiReadyAgents.length ? 'success' : 'warning'}>{apiReadyAgents.length ? '已有可接入 Agent' : '待补齐接入治理'}</Tag>
          </div>
          <strong>POST /v1/responses</strong>
          <div className="forge-contract-code">
            <span>model</span>
            <code>{primaryAgent?.contract_model || 'agent:<service_slug>'}</code>
            <button type="button" title="复制调用标识" disabled={!primaryAgent?.contract_model} onClick={() => copyText(primaryAgent?.contract_model || '')}>
              <Copy size={14} />
            </button>
          </div>
          <div className="forge-contract-metrics">
            <div><span>Agent 总数</span><strong>{metricValue(command.data?.metrics, 'agents')}</strong></div>
            <div><span>可接入</span><strong>{apiReadyAgents.length}</strong></div>
            <div><span>运行证据</span><strong>{metricValue(command.data?.metrics, 'runs')}</strong></div>
          </div>
        </aside>
      </section>

      <section className="forge-home-delivery" aria-label="Agent 服务交付链路">
        <div className="forge-section-heading">
          <div>
            <span>交付链路</span>
            <h2>一条链路管理 Agent 的设计、上线、调用和复核</h2>
          </div>
          <Button size="small" icon={<ArrowRight size={14} />} onClick={() => navigateTo('/agents')}>进入构建区</Button>
        </div>
        <div className="forge-delivery-grid">
          {deliverySteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <button type="button" className="forge-delivery-step" key={step.title} onClick={() => navigateTo(step.target)}>
                <div className="forge-step-index">{index + 1}</div>
                <Icon size={18} />
                <strong>{step.title}</strong>
                <span>{step.body}</span>
                <em>{step.action}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="forge-home-focus-grid">
        <div className="forge-service-panel">
          <div className="forge-section-heading compact">
            <div>
              <span>当前服务</span>
              <h2>优先把 Agent 变成可接入服务</h2>
            </div>
            <Button size="small" onClick={() => navigateTo('/services')}>服务目录</Button>
          </div>
          <div className="forge-service-list">
            {topAgents.map((agent) => {
              const state = agentState(agent);
              return (
                <button type="button" className="forge-service-row" key={agent.id} onClick={() => navigateTo(agent.catalog_ready ? '/services' : '/agents')}>
                  <div>
                    <strong>{agent.name || '未命名 Agent'}</strong>
                    <span>{agent.catalog_ready ? agent.contract_model : agent.next_action || '补齐服务边界和接入治理'}</span>
                  </div>
                  <Tag color={state.color}>{state.label}</Tag>
                </button>
              );
            })}
            {!topAgents.length && <div className="mini-empty">暂无 Agent。先从 Agent Studio 创建第一个服务对象。</div>}
          </div>
        </div>

        <div className="forge-evidence-panel">
          <div className="forge-section-heading compact">
            <div>
              <span>运行闭环</span>
              <h2>Run Evidence 是交付后的事实账本</h2>
            </div>
            <Button size="small" onClick={() => navigateTo('/runs')}>运行证据</Button>
          </div>
          <div className="forge-run-list">
            {runsData.map((run) => {
              const status = runStatusLabel[run.status] || { label: run.status, color: 'default' };
              return (
                <button type="button" className="forge-run-row" key={run.id} onClick={() => navigateTo('/runs')}>
                  <div>
                    <strong>{run.agent_name || '未命名 Agent'}</strong>
                    <span>{run.input_preview || run.output_preview || run.error || '无运行摘要'}</span>
                  </div>
                  <Tag color={status.color}>{status.label}</Tag>
                  <em>{formatDuration(run.duration_ms)}</em>
                </button>
              );
            })}
            {!runsData.length && <div className="mini-empty">暂无运行证据。</div>}
          </div>
        </div>
      </section>

      <section className="forge-home-foundation" aria-label="Runtime 资产底座">
        <div className="forge-foundation-copy">
          <span>Runtime 底座</span>
          <h2>Agent 的运行能力来自模型通道、Tools、Skills 和 Runtime Manifest。</h2>
          <p>前端展示后端聚合后的运行真相，不在页面里复算 Tool / Skill 可用性；preflight、manifest、execution 使用同一套 Runtime capability 语义。</p>
        </div>
        <div className="forge-foundation-grid">
          {foundationItems.map((item) => {
            const Icon = item.icon;
            return (
              <button type="button" className={item.issue ? 'forge-foundation-card warning' : 'forge-foundation-card'} key={item.label} onClick={() => navigateTo(item.target)}>
                <Icon size={17} />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <em>{item.issue ? `${item.issue} 项待处理` : '状态正常'}</em>
              </button>
            );
          })}
        </div>
        <button type="button" className="forge-audit-link" onClick={() => navigateTo('/audit')}>
          <ClipboardCheck size={16} />
          <span>关键变更进入审计日志，访问令牌在访问控制中统一管理。</span>
          <ArrowRight size={14} />
        </button>
      </section>
    </div>
  );
}
