import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  GitBranch,
  PlayCircle,
  RotateCw,
  ShieldCheck,
} from 'lucide-react';
import { SectionCard } from '@/components/layout';
import { PageSurface, TableToolbar, WorkspacePage } from '../components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '../services/api';
import { agentLifecycleMeta } from '../services/agentLifecycle';
import { productTerms } from '../services/productLanguage';
import type { RegressionQualityAgent, RegressionQualityCase, RegressionQualityOverview } from '../types/domain';

function shortHash(value?: string | null) {
  return value ? value.slice(0, 12) : '-';
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function statusBadgeNode(value: string) {
  const meta: Record<string, { label: string; variant: 'success' | 'info' | 'destructive' | 'warning' | 'muted' }> = {
    published: { label: agentLifecycleMeta.published.label, variant: 'success' },
    unpublished: { label: agentLifecycleMeta.unpublished.label, variant: 'warning' },
    inactive: { label: agentLifecycleMeta.inactive.label, variant: 'muted' },
    passed: { label: '通过', variant: 'success' },
    failed: { label: '失败', variant: 'destructive' },
    error: { label: '异常', variant: 'destructive' },
    running: { label: '运行中', variant: 'info' },
    untested: { label: '未运行', variant: 'muted' },
  };
  const item = meta[value] || { label: value || '-', variant: 'muted' as const };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

function agentStatusLabel(value: string) {
  if (value === 'published' || value === 'unpublished' || value === 'inactive') {
    return agentLifecycleMeta[value].label;
  }
  return value || '-';
}

function freshnessBadge(value: RegressionQualityCase['freshness']) {
  const meta = {
    current: { label: '当前配置', variant: 'success' as const },
    stale: { label: '配置已变更', variant: 'warning' as const },
    untested: { label: '未运行', variant: 'muted' as const },
    inactive: { label: '停用', variant: 'muted' as const },
  }[value];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function severityBadge(value: RegressionQualityCase['severity']) {
  if (value === 'critical') return <Badge variant="destructive">严重</Badge>;
  if (value === 'warning') return <Badge variant="warning">{productTerms.riskNotice}</Badge>;
  return <Badge variant="muted">信息</Badge>;
}

function gateTone(blockedAgents = 0, failed = 0, stale = 0, untested = 0) {
  if (failed || blockedAgents) return 'blocked';
  if (stale || untested) return 'warning';
  return 'ready';
}

function gateCopy(data?: RegressionQualityOverview) {
  if (!data) {
    return {
      label: '正在读取',
      title: '正在同步上线检查数据',
      detail: '上线检查尚未完成加载，不会把未知状态展示为通过。',
      tone: 'loading',
    };
  }
  const state = gateTone(data.blocked_agents, data.failed, data.stale, data.untested);
  if (state === 'blocked') {
    return {
      label: '存在未通过项',
      title: `${data.blocked_agents} 个 Agent 不能上线`,
      detail: `${data.blockers} 项未通过需要处理：${data.failed} 失败 / ${data.stale} 过期 / ${data.untested} 未运行。`,
      tone: state,
    };
  }
  if (state === 'warning') {
    return {
      label: '需要复核',
      title: '验收结果需要补齐',
      detail: `${data.stale} 个用例对应的当前配置已变更，${data.untested} 个用例尚未运行。`,
      tone: state,
    };
  }
  if (data.agents === 0) {
    return {
      label: '尚未纳入',
      title: '暂无智能体进入上线检查',
      detail: '完成 Agent Studio 配置和验收用例后，可查看检查结果。',
      tone: 'empty',
    };
  }
  return {
    label: '可以复核',
    title: '当前检查结果可进入人工复核',
    detail: `${data.passed}/${data.active_cases} 个启用用例匹配当前配置。`,
    tone: state,
  };
}

function goAgents(agentId?: string) {
  window.history.pushState({}, '', '/agents');
  window.dispatchEvent(new Event('popstate'));
  if (agentId) sessionStorage.setItem('agent_forge_focus_agent', agentId);
}

const gateToneBadgeVariant: Record<string, 'destructive' | 'warning' | 'success' | 'muted'> = {
  blocked: 'destructive',
  warning: 'warning',
  ready: 'success',
  loading: 'muted',
  empty: 'muted',
};

export default function QualityPage() {
  const [caseFilter, setCaseFilter] = useState<'all' | 'critical' | 'stale' | 'untested' | 'running'>('all');
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ['quality-regression-overview'],
    queryFn: () => api.regressionQualityOverview({ limit: 120 }),
  });
  const runSuite = useMutation({
    mutationFn: (agentId: string) => api.runReleaseTestSuite(agentId),
    onSuccess: (_, agentId) => {
      queryClient.invalidateQueries({ queryKey: ['quality-regression-overview'] });
      queryClient.invalidateQueries({ queryKey: ['agent-regression-coverage', agentId] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight', agentId] });
      queryClient.invalidateQueries({ queryKey: ['agent-completeness', agentId] });
      queryClient.invalidateQueries({ queryKey: ['test-cases', agentId] });
      queryClient.invalidateQueries({ queryKey: ['test-suite-runs', agentId] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const data = overview.data;
  const gate = gateCopy(data);
  const gateState = gate.tone;
  const gateLabel = gate.label;
  const blockedAgents = useMemo(
    () => (data?.agent_summaries || []).filter((item) => !item.can_publish),
    [data?.agent_summaries],
  );
  const readyAgents = useMemo(
    () => (data?.agent_summaries || []).filter((item) => item.can_publish),
    [data?.agent_summaries],
  );
  const blockerCases = useMemo(() => (
    (data?.blocker_cases || []).filter((item) => {
      if (caseFilter === 'all') return true;
      if (caseFilter === 'critical') return item.severity === 'critical';
      if (caseFilter === 'running') return item.result_status === 'running';
      return item.freshness === caseFilter;
    })
  ), [caseFilter, data?.blocker_cases]);

  return (
    <WorkspacePage
      icon={<FlaskConical size={14} />}
      eyebrow="构建"
      title="发布门禁"
      description="用验收用例判断 Agent 是否可以生成 Release，并把需要处理的问题集中到正式发布队列。"
      actions={(
        <Button variant="outline" onClick={() => overview.refetch()} disabled={overview.isFetching}>
          {overview.isFetching ? (
            <RotateCw className="size-4 animate-spin" />
          ) : (
            <RotateCw className="size-4" />
          )}
          刷新
        </Button>
      )}
    >
      {overview.isError && (
        <PageSurface>
          <div className="flex items-center gap-3 py-2">
            <AlertTriangle className="size-5 shrink-0 text-destructive" />
            <div className="flex flex-col gap-0.5">
              <strong className="text-sm font-semibold text-foreground">上线检查数据读取失败</strong>
              <span className="text-sm text-muted-foreground">
                {overview.error instanceof Error ? overview.error.message : '请稍后重试，或检查登录状态与后端服务。'}
              </span>
            </div>
            <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => overview.refetch()}>
              <RotateCw className="size-4" />
              重新读取
            </Button>
          </div>
        </PageSurface>
      )}

      {/* 上线质量总览 */}
      <section aria-label="上线质量总览" className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:justify-between">
          {/* 门禁状态文字区 */}
          <div className="flex flex-col gap-3 min-w-0">
            <Badge variant={gateToneBadgeVariant[gateState] ?? 'muted'} className="w-fit">
              {gateLabel}
            </Badge>
            <h2 className="text-xl font-semibold text-foreground">{gate.title}</h2>
            <p className="text-sm text-muted-foreground">
              {gate.detail}
              {data?.generated_at ? ` 最近生成于 ${formatDate(data.generated_at)}。` : ''}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="default"
                disabled={!blockedAgents[0]}
                onClick={() => blockedAgents[0] && runSuite.mutate(blockedAgents[0].agent_id)}
              >
                {runSuite.isPending ? (
                  <RotateCw className="size-4 animate-spin" />
                ) : (
                  <PlayCircle className="size-4" />
                )}
                运行上线验收
              </Button>
              <Button
                variant="outline"
                onClick={() => goAgents(blockedAgents[0]?.agent_id || readyAgents[0]?.agent_id)}
              >
                <GitBranch className="size-4" />
                打开 Agent Studio
              </Button>
            </div>
          </div>

          {/* 门禁数字账本 */}
          <div className="flex shrink-0 flex-col gap-4 sm:min-w-[240px]">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-muted-foreground">服务范围</span>
              <strong className="text-2xl font-semibold text-foreground">
                {overview.isLoading ? '读取中' : `${data?.agents || 0} 个智能体`}
              </strong>
              <em className="text-xs text-muted-foreground not-italic">
                {overview.isLoading ? '等待后端返回' : `${data?.publish_ready_agents || 0} 个可上线`}
              </em>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-muted-foreground">验收覆盖</span>
              <strong className="text-2xl font-semibold text-foreground">
                {overview.isLoading ? '-' : `${data?.coverage_percent || 0}%`}
              </strong>
              <em className="text-xs text-muted-foreground not-italic">
                {overview.isLoading ? '尚未判定' : `${data?.passed || 0}/${data?.active_cases || 0} 个当前通过`}
              </em>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-muted-foreground">待处理问题</span>
              <strong className="text-2xl font-semibold text-foreground">
                {overview.isLoading ? '-' : `${data?.blockers || 0} 项`}
              </strong>
              <em className="text-xs text-muted-foreground not-italic">
                {overview.isLoading ? '等待检查结果' : `${data?.failed || 0} 失败 / ${data?.stale || 0} 过期 / ${data?.untested || 0} 未运行`}
              </em>
            </div>
          </div>
        </div>
      </section>

      {/* 质量判断 + 问题队列 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PageSurface
          title="质量判断"
          description="失败、需重跑和未运行用例会影响上线判断。"
        >
          <div className="flex items-center gap-5 pb-4">
            {/* 环形进度替换为弧形数字展示 */}
            <div className="flex size-20 shrink-0 flex-col items-center justify-center rounded-full border-4 border-primary/20 text-center">
              <span className="text-lg font-bold text-foreground">{data?.coverage_percent || 0}%</span>
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <strong className="text-sm font-semibold text-foreground">{gateLabel}</strong>
              <span className="text-sm text-muted-foreground">
                {data?.blocked_agents ? `${data.blocked_agents} 个 Agent 存在未通过项` : '验收结果与当前配置一致'}
              </span>
              <em className="text-xs text-muted-foreground not-italic">
                Agent Studio 配置变化会使旧结果失效，需要重新运行验收。
              </em>
            </div>
          </div>
          <Progress value={data?.coverage_percent || 0} className="mb-4" />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
              <span className="text-xs text-muted-foreground">失败/异常</span>
              <strong className="text-xl font-semibold text-destructive">{data?.failed || 0}</strong>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
              <span className="text-xs text-muted-foreground">运行中</span>
              <strong className="text-xl font-semibold text-info">{data?.running || 0}</strong>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
              <span className="text-xs text-muted-foreground">配置已变更</span>
              <strong className="text-xl font-semibold text-warning">{data?.stale || 0}</strong>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
              <span className="text-xs text-muted-foreground">尚未运行</span>
              <strong className="text-xl font-semibold text-muted-foreground">{data?.untested || 0}</strong>
            </div>
          </div>
        </PageSurface>

        <PageSurface
          title="问题队列"
          description="严重失败优先；配置变更和未运行用例进入补测。"
          actions={(
            <Select value={caseFilter} onValueChange={(v) => setCaseFilter(v as typeof caseFilter)}>
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="critical">严重</SelectItem>
                <SelectItem value="running">运行中</SelectItem>
                <SelectItem value="stale">配置已变更</SelectItem>
                <SelectItem value="untested">未运行</SelectItem>
              </SelectContent>
            </Select>
          )}
        >
          <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
            {blockerCases.map((item) => (
              <button
                type="button"
                key={`${item.agent_id}-${item.id}`}
                onClick={() => goAgents(item.agent_id)}
                className="flex flex-col gap-1 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent/50 cursor-pointer"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {severityBadge(item.severity)}
                  {statusBadgeNode(item.result_status)}
                  {freshnessBadge(item.freshness)}
                  <strong className="text-sm font-medium text-foreground ml-0.5">{item.name}</strong>
                </div>
                <span className="text-xs text-muted-foreground">{item.agent_name} · {item.reason}</span>
                <em className="text-xs text-muted-foreground not-italic truncate">{item.input_preview || '无输入预览'}</em>
              </button>
            ))}
            {!blockerCases.length && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 className="size-5 text-success" />
                <strong className="text-sm font-medium text-foreground">当前筛选下没有问题用例</strong>
                <span className="text-xs text-muted-foreground">可以切换筛选，或打开 Agent Studio 补充新的验收用例。</span>
              </div>
            )}
          </div>
        </PageSurface>
      </div>

      {/* Agent 上线状态卡片 */}
      <PageSurface
        title="Agent 上线状态"
        description="按 Agent 查看上线状态、验收覆盖和下一步处理对象。"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data?.agent_summaries || []).slice(0, 6).map((agent) => (
            <button
              type="button"
              key={agent.agent_id}
              onClick={() => goAgents(agent.agent_id)}
              className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 cursor-pointer ${
                agent.can_publish ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'
              }`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {agent.can_publish ? (
                  <ShieldCheck className="size-4 text-success" />
                ) : (
                  <AlertTriangle className="size-4 text-destructive" />
                )}
                <strong className="text-sm font-medium text-foreground">{agent.agent_name}</strong>
                {statusBadgeNode(agent.status)}
              </div>
              <span className="text-xs text-muted-foreground">
                {agent.status === 'published' ? `已上线 v${agent.version}` : agentStatusLabel(agent.status)}
                {' · '}
                {agent.latest_suite_run?.is_current ? '验收匹配当前配置' : '需要复核当前配置'}
              </span>
              <em className="text-xs text-muted-foreground not-italic">
                {agent.passed}/{agent.total} 通过 · {agent.blockers.length ? `${agent.blockers.length} 项未通过` : '无未通过项'}
              </em>
            </button>
          ))}
          {!overview.isLoading && !(data?.agent_summaries || []).length && (
            <div className="col-span-full">
              <EmptyState title="暂无上线检查数据" compact />
            </div>
          )}
        </div>
      </PageSurface>

      {/* 验收结果表 */}
      <SectionCard contentPadding={false}>
        <div className="px-5 py-3.5">
          <TableToolbar
            title="验收结果表"
            description="按服务查看最近验收结果和重跑入口。"
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">服务</TableHead>
              <TableHead className="w-[96px]">状态</TableHead>
              <TableHead className="w-[180px]">覆盖率</TableHead>
              <TableHead className="w-[240px]">未通过项</TableHead>
              <TableHead className="w-[220px]">最近套件</TableHead>
              <TableHead className="w-[140px]">配置证据</TableHead>
              <TableHead className="w-[120px] text-right pr-5">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                  加载中…
                </TableCell>
              </TableRow>
            )}
            {!overview.isLoading && (data?.agent_summaries || []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <EmptyState title="暂无验收数据" compact />
                </TableCell>
              </TableRow>
            )}
            {(data?.agent_summaries || []).map((record: RegressionQualityAgent) => (
              <TableRow key={record.agent_id}>
                <TableCell>
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline cursor-pointer"
                    onClick={() => goAgents(record.agent_id)}
                  >
                    {record.agent_name}
                  </button>
                </TableCell>
                <TableCell>
                  {statusBadgeNode(record.status)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={record.coverage_percent} className="flex-1" />
                    <span className="shrink-0 text-xs text-muted-foreground">{record.passed}/{record.total}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {record.failed > 0 && <Badge variant="destructive">失败 {record.failed}</Badge>}
                    {record.running > 0 && <Badge variant="info">运行中 {record.running}</Badge>}
                    {record.stale > 0 && <Badge variant="warning">需重跑 {record.stale}</Badge>}
                    {record.untested > 0 && <Badge variant="muted">未运行 {record.untested}</Badge>}
                    {record.can_publish && <Badge variant="success">可上线</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  {record.latest_suite_run ? (
                    <span className="text-sm text-muted-foreground">
                      {record.latest_suite_run.passed}/{record.latest_suite_run.total}
                      {' · '}
                      {record.latest_suite_run.is_current ? '当前配置' : '配置已变更'}
                      {' · '}
                      {formatDate(record.latest_suite_run.ended_at)}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="muted">spec {shortHash(record.runtime_plan_hash)}</Badge>
                </TableCell>
                <TableCell className="text-right pr-5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runSuite.isPending}
                    onClick={() => runSuite.mutate(record.agent_id)}
                  >
                    {runSuite.isPending ? (
                      <RotateCw className="size-3.5 animate-spin" />
                    ) : (
                      <PlayCircle className="size-3.5" />
                    )}
                    运行验收
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </WorkspacePage>
  );
}
