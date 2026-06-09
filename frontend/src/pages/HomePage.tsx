import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
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
import { navigate } from '../app/navigation';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge, type BadgeProps } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { cn } from '@/lib/utils';

const runStatusLabel: Record<AgentRun['status'], string> = {
  completed: '成功',
  failed: '失败',
  running: '运行中',
  cancelled: '已取消',
  stale: '超时',
  blocked: '已阻断',
};

const runStatusVariant: Record<AgentRun['status'], BadgeProps['variant']> = {
  completed: 'success',
  failed: 'destructive',
  running: 'info',
  cancelled: 'muted',
  stale: 'warning',
  blocked: 'destructive',
};

const lifecycleVariant: Record<Agent['status'], BadgeProps['variant']> = {
  published: 'success',
  unpublished: 'warning',
  inactive: 'muted',
};

function formatDuration(value?: number | null) {
  if (!value) return '-';
  if (value < 1000) return `${value} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} 秒`;
  return `${Math.floor(value / 60000)} 分 ${Math.round((value % 60000) / 1000)} 秒`;
}

function shortId(value?: string | null) {
  if (!value) return '-';
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

interface StatTile {
  key: string;
  label: string;
  value: number;
  detail: string;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'muted';
  path: string;
}

const toneRing: Record<StatTile['tone'], string> = {
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  muted: 'text-muted-foreground',
};

export default function HomePage({ currentUser }: WorkspacePageContext) {
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
      .sort(
        (left, right) =>
          score(left) - score(right) ||
          new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
      )
      .slice(0, 5);
  }, [agentList]);

  const incidentItems = (incidents.data?.queues || []).flatMap((queue) => queue.items).slice(0, 4);
  const readinessStatus = readiness.data?.status || 'blocked';
  const evidenceTotal = stats.data?.runs ?? runList.length;
  const pendingCount =
    workspaceStats.pendingPublish.length + workspaceStats.unpublished.length + incidentItems.length;
  const productionHealth =
    readinessStatus === 'ready' && !incidentItems.length
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

  const tiles: StatTile[] = [
    {
      key: 'pending',
      label: '待推进',
      value: pendingCount,
      detail: `${workspaceStats.pendingPublish.length} 配置变更 · ${workspaceStats.unpublished.length} 未上线`,
      tone: pendingCount ? 'warning' : 'success',
      path: '/agents',
    },
    {
      key: 'services',
      label: '已上线服务',
      value: workspaceStats.published.length,
      detail: `${evidenceTotal} 条运行证据`,
      tone: 'primary',
      path: '/services',
    },
    {
      key: 'incidents',
      label: '运行异常',
      value: incidentItems.length,
      detail: '近 24 小时高优先级',
      tone: incidentItems.length ? 'danger' : 'success',
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
  ];

  const loading = agents.isLoading || runs.isLoading;

  return (
    <div className="mx-auto flex h-full w-full max-w-[1320px] flex-col gap-5">
      {/* Intro */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <RadioTower className="size-3.5" /> 工作区
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {currentUser?.organization.name || '企业空间'}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            {nextAction}。内部验证和外部调用都写入同一套运行证据。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/services')}>
            <Compass /> Agent 广场
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/experience')}>
            <PlayCircle /> 体验台
          </Button>
          <Button size="sm" disabled={!canEdit} onClick={() => navigate('/agents')}>
            <PenLine /> 新建服务
          </Button>
        </div>
      </section>

      {/* Stat tiles */}
      <section className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)
          : tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                onClick={() => navigate(tile.path)}
                className="group text-left"
              >
                <Card className="h-full p-4 transition-all hover:border-primary/30 hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{tile.label}</span>
                    <ArrowRight className="size-3.5 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                  </div>
                  <div className={cn('mt-2 text-3xl font-semibold tabular-nums', toneRing[tile.tone])}>
                    {tile.value}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{tile.detail}</div>
                </Card>
              </button>
            ))}
      </section>

      {/* Workbench — fills remaining height */}
      <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* Agent queue */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border p-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Agent 服务队列</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                优先处理配置变更、未上线服务和最近运行异常。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/agents')}>
              <PenLine /> 进入 Studio
            </Button>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {loading && (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            )}
            {!loading &&
              priorityAgents.map((agent) => {
                const settled = agent.status === 'published' && !agent.config_pending_publish;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => navigate('/agents')}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/60"
                  >
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-lg',
                        settled ? 'bg-success/12 text-success' : 'bg-warning/14 text-warning',
                      )}
                    >
                      {settled ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {agent.name || '未命名 Agent 服务'}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {agent.description || '尚未填写业务场景'}
                      </div>
                    </div>
                    <Badge variant={lifecycleVariant[agent.status]}>
                      {agent.config_pending_publish ? '配置变更待上线' : agentLifecycleMeta[agent.status].label}
                    </Badge>
                  </button>
                );
              })}
            {!loading && !priorityAgents.length && (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                  <PenLine className="size-4" />
                </div>
                <div className="text-sm text-muted-foreground">
                  暂无待上线 Agent。新建后可在这里完成配置、验收和上线。
                </div>
                {canEdit && (
                  <Button size="sm" className="mt-1" onClick={() => navigate('/agents')}>
                    新建服务
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Run evidence */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border p-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">运行证据</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                统一记录内部验证、外部调用、异常和复验。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/runs')}>
              查看全部
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border p-3.5',
                incidentItems.length
                  ? 'border-warning/30 bg-warning/8'
                  : 'border-success/30 bg-success/8',
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'grid size-9 place-items-center rounded-lg',
                    incidentItems.length ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success',
                  )}
                >
                  {incidentItems.length ? <FileWarning className="size-4" /> : <CheckCircle2 className="size-4" />}
                </span>
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {incidentItems.length ? `${incidentItems.length} 个运行异常` : '风险队列清空'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {incidentItems.length ? '优先复核失败、超时和队列积压。' : '最近没有高优先级运行异常。'}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(incidentItems.length ? '/runs' : '/quality')}
              >
                {incidentItems.length ? '处理异常' : '发布门禁'}
              </Button>
            </div>

            {incidentItems.length > 0 && (
              <div className="space-y-1.5">
                {incidentItems.map((item) => (
                  <button
                    key={item.run_id}
                    type="button"
                    onClick={() => navigate('/runs')}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                  >
                    <FileWarning className="size-4 shrink-0 text-warning" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{item.agent_name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.reason || item.error_preview || '运行异常'}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {shortId(item.run_id)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  最近调用
                </span>
                <span className="text-xs text-muted-foreground">
                  {runList.length ? `${Math.min(runList.length, 8)} 条` : '暂无记录'}
                </span>
              </div>
              <div className="space-y-1">
                {runList.slice(0, 8).map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => navigate('/runs')}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {run.agent_name || '未命名 Agent'}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {run.input_preview || '无输入预览'}
                      </div>
                    </div>
                    <Badge variant={runStatusVariant[run.status]}>
                      {runStatusLabel[run.status] || run.status}
                    </Badge>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {formatDuration(run.duration_ms)}
                    </span>
                  </button>
                ))}
                {!runList.length && !loading && (
                  <div className="py-6 text-center text-sm text-muted-foreground">暂无运行记录。</div>
                )}
              </div>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
