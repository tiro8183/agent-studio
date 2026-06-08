import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Tag } from 'antd';
import {
  CheckCircle2,
  CircleAlert,
  Compass,
  FileWarning,
  PenLine,
  PlayCircle,
  RadioTower,
} from 'lucide-react';
import { api } from '../services/api';
import { canAtLeast } from '../services/authz';
import { agentLifecycleMeta } from '../services/agentLifecycle';
import type { Agent, AgentRun } from '../types/domain';
import type { WorkspacePageContext } from './pageContext';
import { navigateTo } from './agentServiceModel';

const runStatusLabel: Record<AgentRun['status'], string> = {
  completed: '成功',
  failed: '失败',
  running: '运行中',
  cancelled: '已取消',
  stale: '超时',
  blocked: '已阻断',
};

function formatDuration(value?: number | null) {
  if (!value) return '-';
  if (value < 1000) return `${value} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} 秒`;
  return `${Math.floor(value / 60000)} 分 ${Math.round((value % 60000) / 1000)} 秒`;
}

function shortId(value?: string | null) {
  if (!value) return '-';
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function statusTone(status?: Agent['status']) {
  if (status === 'published') return 'ready';
  if (status === 'inactive') return 'muted';
  return 'attention';
}

export default function WorkspaceHomePage({ currentUser }: WorkspacePageContext) {
  const agents = useQuery({ queryKey: ['agents'], queryFn: api.listAgents });
  const runs = useQuery({ queryKey: ['runs', 'home'], queryFn: () => api.listRuns({ limit: 8 }) });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const readiness = useQuery({ queryKey: ['platform-readiness'], queryFn: api.readiness });
  const incidents = useQuery({
    queryKey: ['run-incidents', 'home'],
    queryFn: () => api.runIncidents({ windowMinutes: 1440, staleThresholdMinutes: 120, queueLimit: 4 }),
  });
  const role = currentUser?.membership.role;
  const canEdit = canAtLeast(role, 'editor');
  const agentList = agents.data || [];
  const runList = runs.data || [];

  const workspaceStats = useMemo(() => {
    const published = agentList.filter((agent) => agent.status === 'published');
    const unpublished = agentList.filter((agent) => agent.status === 'unpublished');
    const pendingPublish = agentList.filter((agent) => agent.config_pending_publish);
    const inactive = agentList.filter((agent) => agent.status === 'inactive');
    return { published, unpublished, pendingPublish, inactive };
  }, [agentList]);

  const priorityAgents = useMemo(() => {
    const score = (agent: Agent) => {
      if (agent.config_pending_publish) return 0;
      if (agent.status === 'unpublished') return 1;
      if (agent.status === 'published') return 2;
      return 3;
    };
    return [...agentList]
      .sort((left, right) => score(left) - score(right) || new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
      .slice(0, 5);
  }, [agentList]);

  const incidentItems = (incidents.data?.queues || []).flatMap((queue) => queue.items).slice(0, 4);
  const readinessStatus = readiness.data?.status || 'blocked';
  const evidenceTotal = stats.data?.runs ?? runList.length;
  const pendingCount = workspaceStats.pendingPublish.length + workspaceStats.unpublished.length + incidentItems.length;
  const productionHealth = readinessStatus === 'ready' && !incidentItems.length
    ? '运行稳定'
    : readinessStatus === 'blocked'
      ? '基础配置待处理'
      : '需要复核';
  const nextAction = workspaceStats.pendingPublish.length
    ? '处理配置变更'
    : workspaceStats.unpublished.length
      ? '推进未上线 Agent'
      : incidentItems.length
        ? '复核运行异常'
        : '验证新业务任务';
  const commandItems = [
    {
      key: 'pending',
      label: '待推进',
      value: pendingCount,
      detail: `${workspaceStats.pendingPublish.length} 配置变更 / ${workspaceStats.unpublished.length} 未上线`,
      tone: pendingCount ? 'warning' : 'ready',
      path: '/agents',
    },
    {
      key: 'services',
      label: '已上线',
      value: workspaceStats.published.length,
      detail: `${evidenceTotal} 条运行证据`,
      tone: 'ready',
      path: '/services',
    },
    {
      key: 'incidents',
      label: '异常',
      value: incidentItems.length,
      detail: '近 24 小时高优先级',
      tone: incidentItems.length ? 'blocked' : 'ready',
      path: '/runs',
    },
    {
      key: 'inactive',
      label: '停用',
      value: workspaceStats.inactive.length,
      detail: productionHealth,
      tone: 'muted',
      path: '/quality',
    },
  ] as const;

  return (
    <div className="page workspace-home-page">
      <header className={`home-command-strip ${readinessStatus}`}>
        <div className="home-command-title">
          <div className="eyebrow"><RadioTower size={14} /> 工作区</div>
          <h1>{currentUser?.organization.name || '企业空间'}</h1>
          <p>{nextAction}。内部验证和外部调用都写入同一套运行证据。</p>
        </div>
        <div className="home-command-board" aria-label="工作区队列">
          {commandItems.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`home-command-item ${item.tone}`}
              onClick={() => navigateTo(item.path)}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <em>{item.detail}</em>
            </button>
          ))}
        </div>
        <div className="home-command-actions">
          <Button icon={<Compass size={15} />} onClick={() => navigateTo('/services')}>Agent 广场</Button>
          <Button icon={<PlayCircle size={15} />} onClick={() => navigateTo('/experience')}>体验台</Button>
          <Button type="primary" icon={<PenLine size={15} />} disabled={!canEdit} onClick={() => navigateTo('/agents')}>
            新建服务
          </Button>
        </div>
      </header>

      <section className="home-production-ledger" aria-label="生产态势">
        <button type="button" className={pendingCount ? 'home-ledger-cell primary warning' : 'home-ledger-cell primary'} onClick={() => navigateTo('/agents')}>
          <span>待推进事项</span>
          <strong>{pendingCount}</strong>
          <em>{workspaceStats.pendingPublish.length} 个配置变更待上线 · {workspaceStats.unpublished.length} 个未上线 · {incidentItems.length} 个异常</em>
        </button>
        <button type="button" className="home-ledger-cell ready" onClick={() => navigateTo('/services')}>
          <span>已上线服务</span>
          <strong>{workspaceStats.published.length}</strong>
          <em>{productionHealth} · {evidenceTotal} 条运行记录</em>
        </button>
        <button type="button" className={incidentItems.length ? 'home-ledger-cell warning' : 'home-ledger-cell ready'} onClick={() => navigateTo('/runs')}>
          <span>运行待复核</span>
          <strong>{incidentItems.length}</strong>
          <em>近 24 小时高优先级</em>
        </button>
      </section>

      <section className="home-workbench-grid">
        <div className="home-work-queue">
          <div className="home-section-title">
            <div>
              <strong>Agent 服务队列</strong>
              <span>优先处理配置变更、未上线服务和最近运行异常。</span>
            </div>
            <Button size="small" icon={<PenLine size={14} />} onClick={() => navigateTo('/agents')}>进入 Studio</Button>
          </div>
          <div className="home-service-list">
            {priorityAgents.map((agent) => (
              <button type="button" className="home-service-row" key={agent.id} onClick={() => navigateTo('/agents')}>
                <div className={`home-service-state ${statusTone(agent.status)}`}>
                  {agent.status === 'published' && !agent.config_pending_publish ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
                </div>
                <div>
                  <strong>{agent.name || '未命名 Agent 服务'}</strong>
                  <span>{agent.description || '尚未填写业务场景'}</span>
                </div>
                <Tag color={agentLifecycleMeta[agent.status].color}>{agent.config_pending_publish ? '配置变更待上线' : agentLifecycleMeta[agent.status].label}</Tag>
              </button>
            ))}
            {!priorityAgents.length && <div className="mini-empty">暂无待上线 Agent。新建 Agent 后，可在这里完成配置、验收和上线。</div>}
          </div>
        </div>

        <section className="home-evidence-panel">
          <div className="home-section-title">
            <div>
              <strong>运行证据</strong>
              <span>统一记录内部验证、外部调用、异常和复验。</span>
            </div>
            <Button size="small" onClick={() => navigateTo('/runs')}>查看全部</Button>
          </div>

          <div className="home-risk-summary">
            <div className={incidentItems.length ? 'home-risk-status warning' : 'home-risk-status ready'}>
              {incidentItems.length ? <FileWarning size={16} /> : <CheckCircle2 size={16} />}
              <div>
                <strong>{incidentItems.length ? `${incidentItems.length} 个运行异常` : '风险队列清空'}</strong>
                <span>{incidentItems.length ? '优先复核失败、超时和队列积压。' : '最近没有高优先级运行异常。'}</span>
              </div>
            </div>
            <Button size="small" onClick={() => navigateTo(incidentItems.length ? '/runs' : '/quality')}>
              {incidentItems.length ? '处理异常' : '发布门禁'}
            </Button>
          </div>

          {incidentItems.length > 0 && (
            <div className="home-incident-list">
              {incidentItems.map((item) => (
                <button type="button" className="home-incident-row" key={item.run_id} onClick={() => navigateTo('/runs')}>
                  <FileWarning size={15} />
                  <div>
                    <strong>{item.agent_name}</strong>
                    <span>{item.reason || item.error_preview || '运行异常'}</span>
                  </div>
                  <em>{shortId(item.run_id)}</em>
                </button>
              ))}
            </div>
          )}

          <div className="home-run-timeline">
            <div className="home-run-timeline-head">
              <span>最近调用</span>
              <em>{runList.length ? `${Math.min(runList.length, 5)} 条` : '暂无记录'}</em>
            </div>
            <div className="home-run-list">
              {runList.slice(0, 5).map((run) => (
                <button type="button" className="home-run-row" key={run.id} onClick={() => navigateTo('/runs')}>
                  <div>
                    <strong>{run.agent_name || '未命名 Agent'}</strong>
                    <span>{run.input_preview || '无输入预览'}</span>
                  </div>
                  <Tag color={run.status === 'completed' ? 'success' : run.status === 'running' ? 'processing' : 'error'}>
                    {runStatusLabel[run.status] || run.status}
                  </Tag>
                  <em>{formatDuration(run.duration_ms)}</em>
                </button>
              ))}
              {!runList.length && <div className="mini-empty">暂无运行记录。</div>}
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
