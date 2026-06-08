import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, Database, HardDrive, RefreshCw, RotateCcw, Scissors, ShieldCheck } from 'lucide-react';
import { PageSurface, StatusSummary, WorkspaceIssueList, WorkspaceMetricGrid, WorkspacePage } from '../components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { NumberInput } from '@/components/ui/number-input';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { StatusBadge } from '@/components/ui/status-badge';
import { toast } from '@/lib/toast';
import { formatBytes, formatNumber } from '@/lib/format';
import { api } from '../services/api';
import { productTerms, runtimeActorLabel, visibleRuntimeText } from '../services/productLanguage';
import { workspaceApi } from '../services/workspaceApi';
import type { LLMHealthBreakdownItem, LLMUsageBreakdownItem, OrganizationRole, RunRetentionRequest } from '../types/domain';

const roleRank: Record<OrganizationRole, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function runtimeScopeLabel(item: LLMUsageBreakdownItem | LLMHealthBreakdownItem) {
  return runtimeActorLabel(item.runtime_scope, item.subagent_name);
}

export default function MonitorPage() {
  const queryClient = useQueryClient();
  const [retentionForm, setRetentionForm] = useState<RunRetentionRequest>({});

  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 10000 });
  const workspace = useQuery({ queryKey: ['workspace', 'operations'], queryFn: workspaceApi.operations, refetchInterval: 30000 });
  const llmUsageBreakdown = useQuery({ queryKey: ['llm-usage-breakdown'], queryFn: api.llmUsageBreakdown, refetchInterval: 30000 });
  const llmHealthBreakdown = useQuery({ queryKey: ['llm-health-breakdown'], queryFn: api.llmHealthBreakdown, refetchInterval: 30000 });
  const currentUser = useQuery({ queryKey: ['me'], queryFn: api.me });
  const canViewReadiness = roleRank[currentUser.data?.membership.role || 'viewer'] >= roleRank.admin;
  const readiness = useQuery({
    queryKey: ['platform-readiness'],
    queryFn: api.readiness,
    enabled: canViewReadiness,
    refetchInterval: canViewReadiness ? 30000 : false,
  });
  const runRetention = useQuery({ queryKey: ['run-retention'], queryFn: api.getRunRetention, refetchInterval: 30000 });
  const runtimeState = useQuery({ queryKey: ['runtime-state'], queryFn: api.runtimeState, refetchInterval: 30000 });
  const uploadQuota = useQuery({ queryKey: ['upload-quota'], queryFn: api.uploadQuota, refetchInterval: 30000 });

  const canApplyRetention = canViewReadiness;
  const activeRetention = runRetention.data;
  const effectiveRetentionForm = {
    retain_days: retentionForm.retain_days ?? activeRetention?.policy.retain_days ?? 30,
    retain_minimum: retentionForm.retain_minimum ?? activeRetention?.policy.retain_minimum ?? 200,
    include_running: retentionForm.include_running ?? activeRetention?.policy.include_running ?? false,
  };

  const failedRuns = stats.data?.failed_runs || 0;
  const staleRuns = stats.data?.stale_runs || 0;
  const cancelledRuns = stats.data?.cancelled_runs || 0;
  const runningRuns = stats.data?.running_runs || 0;
  const runRisk = failedRuns + staleRuns + cancelledRuns;
  const readinessLabel = !canViewReadiness
    ? '只读'
    : readiness.data?.status === 'ready' ? '就绪' : readiness.data?.status === 'degraded' ? '降级' : readiness.data?.status === 'blocked' ? '未通过' : '检查中';
  const readinessTone = !canViewReadiness
    ? 'readonly'
    : readiness.data?.status === 'ready' ? 'ready' : readiness.data?.status === 'blocked' ? 'blocked' : 'warning';
  const modelFailedCalls = llmHealthBreakdown.data?.failed_llm_calls || 0;
  const modelSuccessRate = llmHealthBreakdown.data?.success_rate ?? 0;
  const modelTone = modelFailedCalls > 0 ? 'blocked' : modelSuccessRate && modelSuccessRate < 95 ? 'warning' : 'ready';
  const quotaPercent = uploadQuota.data?.usage_percent || 0;
  const quotaTone = quotaPercent >= 90 ? 'blocked' : quotaPercent >= 75 ? 'warning' : 'ready';
  const runtimeWarnings = runtimeState.data?.warnings?.length || 0;
  const runtimeTone = runtimeState.data?.status === 'healthy' && runtimeWarnings === 0 ? 'ready' : 'warning';
  const commandTitle = readinessTone === 'blocked'
    ? '平台就绪检查未通过，先处理基础配置'
    : runRisk > 0
      ? '先处理运行异常，再复核模型与容量'
      : modelTone === 'blocked'
        ? '模型通道出现失败，需要管理员复核'
        : '平台运行状态正常';
  const estimatedDeletedRuns = activeRetention?.dry_run === false
    ? activeRetention.deleted_runs
    : activeRetention?.eligible_runs || 0;
  const retentionImpactMetrics = [
    { label: '可清理运行', value: activeRetention?.eligible_runs || 0 },
    { label: activeRetention?.dry_run === false ? '已清理运行' : '预估清理运行', value: estimatedDeletedRuns },
    { label: '模型调用记录', value: activeRetention?.deleted_llm_logs || 0 },
    { label: `${productTerms.action}运行证据`, value: activeRetention?.deleted_tool_audits || 0 },
    { label: '结构化运行事件', value: activeRetention?.deleted_run_events || 0 },
    { label: '资料召回证据', value: activeRetention?.deleted_knowledge_audits || 0 },
    { label: '重跑引用', value: activeRetention?.cleared_rerun_links || 0 },
  ];

  const refreshOps = () => {
    queryClient.invalidateQueries({ queryKey: ['run-retention'] });
    queryClient.invalidateQueries({ queryKey: ['runtime-state'] });
    queryClient.invalidateQueries({ queryKey: ['upload-quota'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    queryClient.invalidateQueries({ queryKey: ['llm-usage-breakdown'] });
    queryClient.invalidateQueries({ queryKey: ['llm-health-breakdown'] });
  };
  const previewRetention = useMutation({
    mutationFn: () => api.previewRunRetention(effectiveRetentionForm),
    onSuccess: (result) => {
      queryClient.setQueryData(['run-retention'], result);
      toast.success(`已完成预览：${result.eligible_runs} 条运行可清理`);
    },
  });
  const applyRetention = useMutation({
    mutationFn: () => api.applyRunRetention(effectiveRetentionForm),
    onSuccess: (result) => {
      queryClient.setQueryData(['run-retention'], result);
      refreshOps();
      toast.success(`已清理 ${result.deleted_runs} 条运行证据`);
    },
  });

  // Derive progress indicator color based on usage
  const quotaIndicatorClass = quotaPercent >= 90
    ? 'bg-destructive'
    : quotaPercent >= 75
      ? 'bg-warning'
      : 'bg-success';

  return (
    <WorkspacePage
      icon={<Activity size={14} />}
      eyebrow="治理"
      title="可观测性"
      description="查看 Model Provider 可用性、运行证据异常、容量和清理策略。"
      actions={
        canViewReadiness && readiness.data ? (
          <Badge variant={readiness.data.status === 'ready' ? 'success' : readiness.data.status === 'degraded' ? 'warning' : 'destructive'}>
            {readiness.data.environment}
          </Badge>
        ) : undefined
      }
    >
      {/* Operations workspace summary */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Operations Read Model</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{workspace.data?.next_action || '正在读取后端聚合的运行态势。'}</p>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <WorkspaceMetricGrid items={workspace.data?.metrics || []} />
          <WorkspaceIssueList items={workspace.data?.issues || []} emptyLabel="当前没有运维未通过项。" />
        </div>
      </div>

      {/* Status Summary */}
      <StatusSummary
        ariaLabel="平台运行保障台"
        badge={readinessLabel}
        badgeTone={readinessTone}
        title={commandTitle}
        description="运行异常、模型可用性、上传配额和状态存储。"
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshOps}>
              <RefreshCw size={15} />
              刷新状态
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={previewRetention.isPending || runRetention.isFetching}
              onClick={() => previewRetention.mutate()}
            >
              <RotateCcw size={15} />
              预览清理
            </Button>
          </div>
        )}
        items={[
          {
            icon: readinessTone === 'ready' ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />,
            label: '平台就绪',
            value: readinessLabel,
            detail: canViewReadiness ? `${readiness.data?.blockers || 0} 未通过 / ${readiness.data?.warnings || 0} 风险提示` : '当前角色只能查看运行态摘要',
            tone: readinessTone,
          },
          {
            icon: runRisk ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />,
            label: '运行风险',
            value: formatNumber(runRisk),
            detail: `${failedRuns} 失败 / ${staleRuns} 超时未结束 / ${runningRuns} 运行中`,
            tone: runRisk ? 'blocked' : runningRuns ? 'warning' : 'ready',
          },
          {
            icon: modelTone === 'blocked' ? <AlertTriangle size={15} /> : <Activity size={15} />,
            label: '模型可用',
            value: `${modelSuccessRate || 0}%`,
            detail: `${formatNumber(modelFailedCalls)} 次失败 / 首响应 ${formatNumber(llmHealthBreakdown.data?.avg_first_token_ms || 0)}ms`,
            tone: modelTone,
          },
          {
            icon: quotaTone === 'blocked' ? <AlertTriangle size={15} /> : <HardDrive size={15} />,
            label: '容量水位',
            value: `${quotaPercent}%`,
            detail: `${formatBytes(uploadQuota.data?.remaining_bytes || 0)} 剩余 / 运行态 ${formatBytes(runtimeState.data?.runtime_state_bytes || 0)}`,
            tone: quotaTone,
          },
          {
            icon: <Database size={15} />,
            label: '状态存储',
            value: runtimeState.data?.status === 'healthy' ? '健康' : '待复核',
            detail: `${runtimeWarnings} 条维护风险提示 / ${formatNumber(runtimeState.data?.checkpoints || 0)} 个检查点`,
            tone: runtimeTone,
          },
        ]}
      />

      {/* Ops workbench */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* LLM Usage Breakdown */}
        <PageSurface
          title="模型调用分布"
          description={`按主流程、${productTerms.workRole}、模型和通道来源聚合调用量与 Token，帮助判断通道质量和资源消耗。`}
          actions={
            llmUsageBreakdown.data ? (
              <Badge variant="info">
                {formatNumber(llmUsageBreakdown.data.total_llm_calls)} 次调用
              </Badge>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-4">
            {/* Summary metrics */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-0.5">
                <strong className="text-lg font-semibold text-foreground">{formatNumber(llmUsageBreakdown.data?.total_llm_calls || 0)}</strong>
                <span className="text-xs text-muted-foreground">总调用</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <strong className="text-lg font-semibold text-foreground">{formatNumber(llmUsageBreakdown.data?.total_tokens || 0)}</strong>
                <span className="text-xs text-muted-foreground">总 Token</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <strong className="text-lg font-semibold text-foreground">{formatNumber(llmUsageBreakdown.data?.input_tokens || 0)}</strong>
                <span className="text-xs text-muted-foreground">输入 Token</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <strong className="text-lg font-semibold text-foreground">{formatNumber(llmUsageBreakdown.data?.output_tokens || 0)}</strong>
                <span className="text-xs text-muted-foreground">输出 Token</span>
              </div>
            </div>
            {/* Per-item breakdown */}
            <div className="flex flex-col gap-2">
              {(llmUsageBreakdown.data?.items || []).slice(0, 8).map((item) => (
                <div
                  key={`${item.runtime_scope}-${item.subagent_name}-${item.provider_type}-${item.model}-${item.llm_config_id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-medium text-foreground">{runtimeScopeLabel(item)}</strong>
                    <span className="text-xs text-muted-foreground">{item.provider_type || '-'} · {item.model || '-'}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                    <span><strong className="text-foreground">{formatNumber(item.total_tokens)}</strong> Token</span>
                    <span><strong className="text-foreground">{formatNumber(item.llm_calls)}</strong> 调用</span>
                    <span><strong className="text-foreground">{formatNumber(item.input_tokens)}</strong> 输入</span>
                    <span><strong className="text-foreground">{formatNumber(item.output_tokens)}</strong> 输出</span>
                  </div>
                </div>
              ))}
              {!llmUsageBreakdown.isLoading && !(llmUsageBreakdown.data?.items || []).length && (
                <p className="text-sm text-muted-foreground py-2">还没有模型调用数据。</p>
              )}
            </div>
          </div>
        </PageSurface>

        {/* LLM Health Breakdown */}
        <PageSurface
          title="模型健康"
          description={`按主流程、${productTerms.workRole}、通道来源和模型聚合成功率、失败调用、平均耗时和首响应延迟。`}
          actions={
            llmHealthBreakdown.data ? (
              <Badge variant={llmHealthBreakdown.data.failed_llm_calls > 0 ? 'destructive' : 'success'}>
                {llmHealthBreakdown.data.success_rate}% 成功率
              </Badge>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-4">
            {/* Summary metrics */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-0.5">
                <strong className="text-lg font-semibold text-foreground">{formatNumber(llmHealthBreakdown.data?.total_llm_calls || 0)}</strong>
                <span className="text-xs text-muted-foreground">总调用</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <strong className="text-lg font-semibold text-foreground">{llmHealthBreakdown.data?.success_rate || 0}%</strong>
                <span className="text-xs text-muted-foreground">成功率</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <strong className="text-lg font-semibold text-foreground">{formatNumber(llmHealthBreakdown.data?.failed_llm_calls || 0)}</strong>
                <span className="text-xs text-muted-foreground">失败调用</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <strong className="text-lg font-semibold text-foreground">{formatNumber(llmHealthBreakdown.data?.avg_first_token_ms || 0)}ms</strong>
                <span className="text-xs text-muted-foreground">首响应延迟</span>
              </div>
            </div>
            {/* Per-item breakdown */}
            <div className="flex flex-col gap-2">
              {(llmHealthBreakdown.data?.items || []).slice(0, 8).map((item) => (
                <div
                  key={`${item.runtime_scope}-${item.subagent_name}-${item.provider_type}-${item.model}-${item.llm_config_id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-medium text-foreground">{runtimeScopeLabel(item)}</strong>
                    <span className="text-xs text-muted-foreground">{item.provider_type || '-'} · {item.model || '-'}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 shrink-0 text-xs text-muted-foreground">
                    <span><strong className="text-foreground">{item.success_rate}%</strong> 成功率</span>
                    <span><strong className="text-foreground">{formatNumber(item.failed_llm_calls)}</strong> 失败</span>
                    <span><strong className="text-foreground">{formatNumber(item.avg_duration_ms)}ms</strong> 平均耗时</span>
                    <span><strong className="text-foreground">{formatNumber(item.avg_first_token_ms)}ms</strong> 首响应</span>
                    {item.last_error
                      ? <Badge variant="destructive">{item.last_error}</Badge>
                      : <Badge variant="success">无失败样本</Badge>
                    }
                  </div>
                </div>
              ))}
              {!llmHealthBreakdown.isLoading && !(llmHealthBreakdown.data?.items || []).length && (
                <p className="text-sm text-muted-foreground py-2">还没有模型健康数据。</p>
              )}
            </div>
          </div>
        </PageSurface>
      </div>

      {/* Run Retention Policy */}
      <PageSurface
        title="运行保留策略"
        description="按租户清理过期运行证据，保留最新运行和测试结果。"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={previewRetention.isPending || runRetention.isFetching}
              onClick={() => previewRetention.mutate()}
            >
              <RotateCcw size={14} />
              预览清理
            </Button>
            <Confirm
              title="执行运行证据清理？"
              description={`将清理 ${activeRetention?.eligible_runs || 0} 条符合策略的运行证据。`}
              okText="执行清理"
              cancelText="取消"
              danger
              disabled={!canApplyRetention || !activeRetention?.eligible_runs}
              onConfirm={() => applyRetention.mutate()}
            >
              <Button
                variant="destructive"
                size="sm"
                disabled={!canApplyRetention || !activeRetention?.eligible_runs || applyRetention.isPending}
                title={canApplyRetention ? '执行清理' : '需管理员权限'}
              >
                <Scissors size={14} />
                执行清理
              </Button>
            </Confirm>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Policy panel */}
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">保留天数</label>
                <NumberInput
                  min={1}
                  value={effectiveRetentionForm.retain_days}
                  onChange={(value) => setRetentionForm((current) => ({ ...current, retain_days: Number(value || 1) }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">最低保留</label>
                <NumberInput
                  min={0}
                  value={effectiveRetentionForm.retain_minimum}
                  onChange={(value) => setRetentionForm((current) => ({ ...current, retain_minimum: Number(value || 0) }))}
                />
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch
                  checked={effectiveRetentionForm.include_running}
                  onCheckedChange={(checked) => setRetentionForm((current) => ({ ...current, include_running: checked }))}
                />
                <span className="text-sm font-medium text-foreground">包含运行中</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground"><ShieldCheck size={14} />测试引用保护</span>
                <strong className="text-foreground">{activeRetention?.protected_test_runs || 0}</strong>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground"><ShieldCheck size={14} />最新运行保护</span>
                <strong className="text-foreground">{activeRetention?.protected_minimum_runs || 0}</strong>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground"><ShieldCheck size={14} />运行中保护</span>
                <strong className="text-foreground">{activeRetention?.protected_running_runs || 0}</strong>
              </div>
            </div>
          </div>
          {/* Result panel */}
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-0.5">
                <strong className="text-lg font-semibold text-foreground">{activeRetention?.total_runs || 0}</strong>
                <span className="text-xs text-muted-foreground">总运行</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <strong className="text-lg font-semibold text-foreground">{activeRetention?.retained_runs || 0}</strong>
                <span className="text-xs text-muted-foreground">将保留</span>
              </div>
              {retentionImpactMetrics.map((item) => (
                <div key={item.label} className="flex flex-col gap-0.5">
                  <strong className="text-lg font-semibold text-foreground">{formatNumber(item.value)}</strong>
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">清理边界</span>
              <strong className="text-foreground">{formatDate(activeRetention?.cutoff_at)}</strong>
              <Badge variant={activeRetention?.dry_run === false ? 'success' : 'info'}>
                {activeRetention?.dry_run === false ? '已执行' : '预览'}
              </Badge>
            </div>
            <div className="flex flex-col gap-1.5">
              {(activeRetention?.candidate_runs || []).slice(0, 8).map((candidate) => (
                <div
                  key={candidate.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs"
                >
                  <span className="font-mono text-muted-foreground">{candidate.id}</span>
                  <strong className="text-foreground">{candidate.agent_id}</strong>
                  <StatusBadge status={candidate.status} />
                  <em className="not-italic text-muted-foreground">{formatDate(candidate.ended_at || candidate.started_at)}</em>
                </div>
              ))}
              {!runRetention.isLoading && !(activeRetention?.candidate_runs || []).length && (
                <p className="text-sm text-muted-foreground py-1">当前策略下没有可清理运行。</p>
              )}
            </div>
          </div>
        </div>
      </PageSurface>

      {/* Upload Quota */}
      <PageSurface
        title="上传配额"
        description={`统一约束会话附件和${productTerms.businessMaterial}，避免单租户无限占用存储。`}
        actions={
          uploadQuota.data ? (
            <Badge variant={uploadQuota.data.usage_percent >= 90 ? 'destructive' : uploadQuota.data.usage_percent >= 75 ? 'warning' : 'success'}>
              {uploadQuota.data.usage_percent}%
            </Badge>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <Progress
            value={uploadQuota.data?.usage_percent || 0}
            indicatorClassName={quotaIndicatorClass}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <strong className="text-lg font-semibold text-foreground">{formatBytes(uploadQuota.data?.used_bytes || 0)}</strong>
              <span className="text-xs text-muted-foreground">已使用</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <strong className="text-lg font-semibold text-foreground">{formatBytes(uploadQuota.data?.remaining_bytes || 0)}</strong>
              <span className="text-xs text-muted-foreground">剩余额度</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <strong className="text-lg font-semibold text-foreground">{formatBytes(uploadQuota.data?.attachment_bytes || 0)}</strong>
              <span className="text-xs text-muted-foreground">会话附件</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <strong className="text-lg font-semibold text-foreground">{formatBytes(uploadQuota.data?.knowledge_bytes || 0)}</strong>
              <span className="text-xs text-muted-foreground">{productTerms.businessMaterial}</span>
            </div>
          </div>
        </div>
      </PageSurface>

      {/* Runtime State */}
      <PageSurface
        title="状态存储容量"
        description="只读检查运行检查点、状态存储的容量、位置和维护风险。"
        actions={
          runtimeState.data ? (
            <Badge variant={runtimeState.data.status === 'healthy' ? 'success' : 'warning'}>
              {runtimeState.data.backend}
            </Badge>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <strong className="text-lg font-semibold text-foreground">{formatBytes(runtimeState.data?.runtime_state_bytes || 0)}</strong>
              <span className="text-xs text-muted-foreground">运行态占用</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <strong className="text-lg font-semibold text-foreground">{formatBytes(runtimeState.data?.checkpoint_bytes || 0)}</strong>
              <span className="text-xs text-muted-foreground">检查点文件</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <strong className="text-lg font-semibold text-foreground">{formatBytes(runtimeState.data?.store_bytes || 0)}</strong>
              <span className="text-xs text-muted-foreground">状态存储文件</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <strong className="text-lg font-semibold text-foreground">{runtimeState.data?.store_items || 0}</strong>
              <span className="text-xs text-muted-foreground">状态条目</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">运行态目录</span>
              <strong className="font-mono text-xs text-foreground truncate max-w-[60%] text-right">{runtimeState.data?.state_dir || '-'}</strong>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">检查点数据库</span>
              <strong className="font-mono text-xs text-foreground truncate max-w-[60%] text-right">{runtimeState.data?.checkpoint_exists ? runtimeState.data.checkpoint_db : '未创建'}</strong>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">状态数据库</span>
              <strong className="font-mono text-xs text-foreground truncate max-w-[60%] text-right">{runtimeState.data?.store_exists ? runtimeState.data.store_db : '未创建'}</strong>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">检查点记录</span>
              <strong className="text-foreground">{runtimeState.data?.checkpoints || 0}</strong>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">状态写入</span>
              <strong className="text-foreground">{runtimeState.data?.checkpoint_writes || 0}</strong>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(runtimeState.data?.warnings || []).length ? (
              runtimeState.data?.warnings.map((item) => (
                <Badge variant="warning" key={item}>{visibleRuntimeText(item)}</Badge>
              ))
            ) : (
              <Badge variant="success">当前运行态存储未触发维护告警</Badge>
            )}
          </div>
        </div>
      </PageSurface>
    </WorkspacePage>
  );
}
