import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clipboard,
  FlaskConical,
  LayoutDashboard,
  RotateCcw,
  Scissors,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { StatusTag, WorkspaceIssueList, WorkspaceMetricGrid, WorkspacePage } from '../components/ui';
import { toast } from '@/lib/toast';
import { api } from '../services/api';
import { canAtLeast } from '../services/authz';
import { productTerms, runtimeActorLabel, visibleRuntimeText } from '../services/productLanguage';
import { workspaceApi } from '../services/workspaceApi';
import type { AgentRun, RunIncidentItem, RunTraceEvent } from '../types/domain';
import {
  auditSourceLabel,
  auditSourceVariant,
  auditSummary,
  entrypointMeta,
  entrypointProtocolMeta,
  entrypointTag,
  eventText,
  eventTone,
  failureEvidenceItems,
  formatDate,
  formatDuration,
  formatNumber,
  incidentQueueStatus,
  incidentSeverityVariant,
  isOrganizationRole,
  knowledgeAuditSummary,
  llmActorLabel,
  llmActorVariant,
  llmLogSummary,
  manifestSummary,
  phaseLabels,
  recoveryDeltaItems,
  recoverySnapshotLabel,
  recoveryStatusMeta,
  releaseTag,
  renderEvent,
  roleLabels,
  runLlmContracts,
  runNextActionLabel,
  runSourceMeta,
  runSourceTag,
  runStatusMeta,
  runStatusTag,
  runSummary,
  runTriggerProtocolMeta,
  runtimeSourceMeta,
  shortAuditUser,
  shortCallId,
  shortHash,
  shortRunId,
  statusDomainLabel,
  subagentHandoffItems,
  toolAuditSummary,
  traceStatusLabels,
  type EvidenceIndexKey,
  type RunTabKey,
} from './runCenterModel';

export default function RunCenterPage() {
  const queryClient = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  const [status, setStatus] = useState<string>();
  const [agentId, setAgentId] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [tracePhase, setTracePhase] = useState<RunTraceEvent['phase']>();
  const [traceStatus, setTraceStatus] = useState<RunTraceEvent['status']>();
  const [traceResource, setTraceResource] = useState<string>();
  const [activeRunTab, setActiveRunTab] = useState<RunTabKey>('diagnosis');

  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 10000 });
  const workspace = useQuery({ queryKey: ['workspace', 'run-evidence'], queryFn: () => workspaceApi.runEvidence({ limit: 30 }), refetchInterval: 10000 });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const agents = useQuery({ queryKey: ['agents'], queryFn: api.listAgents });
  const incidents = useQuery({
    queryKey: ['run-incidents', 1440, 120],
    queryFn: () => api.runIncidents({ windowMinutes: 1440, staleThresholdMinutes: 120, queueLimit: 12 }),
    refetchInterval: 10000,
  });
  const runs = useQuery({
    queryKey: ['runs', status || 'all', agentId || 'all-agents', keyword],
    queryFn: () => api.listRuns({ status, agentId, q: keyword, limit: 50 }),
    refetchInterval: 10000,
  });

  const selectedRunFromList = useMemo(
    () => (runs.data || []).find((item) => item.id === selectedRun?.id),
    [runs.data, selectedRun?.id],
  );
  const activeRunId = selectedRun?.id || (runs.data || [])[0]?.id || '';
  const runEvidence = useQuery({
    queryKey: ['run-evidence', activeRunId || 'none'],
    queryFn: () => api.getRunEvidence(activeRunId),
    enabled: Boolean(activeRunId),
    refetchInterval: 10000,
  });
  const runEvents = useQuery({
    queryKey: ['run-events', activeRunId || 'none'],
    queryFn: () => api.listRunEvents(activeRunId),
    enabled: Boolean(activeRunId),
    refetchInterval: 10000,
  });
  const activeRun = runEvidence.data?.run || selectedRunFromList || selectedRun || (runs.data || [])[0] || null;
  const activeEntrypoint = activeRun?.entrypoint || '';
  const activeEntrypointMeta = activeEntrypoint
    ? entrypointProtocolMeta[activeEntrypoint] || {
        name: entrypointMeta[activeEntrypoint]?.label || activeEntrypoint,
        path: activeEntrypoint,
        role: '历史入口',
        note: '历史记录使用的执行入口',
        evidence: '写入统一运行证据',
      }
    : null;
  const activeTriggerMeta = activeRun?.run_source
    ? runTriggerProtocolMeta[activeRun.run_source] || {
        name: runSourceMeta[activeRun.run_source]?.label || activeRun.run_source,
        path: activeRun.run_source,
        role: '触发来源',
        note: '存量记录使用的触发来源',
        evidence: '写入统一运行证据',
      }
    : null;
  const sourceRun = activeRun?.rerun_of_run_id
    ? (runs.data || []).find((item) => item.id === activeRun.rerun_of_run_id) || null
    : null;
  const activeDerivedRuns = activeRun
    ? (runs.data || []).filter((item) => item.rerun_of_run_id === activeRun.id)
    : [];
  const currentRole = me.data?.membership.role || 'viewer';
  const canCancelRun = canAtLeast(currentRole, 'editor');
  const canRerunRun = canAtLeast(currentRole, 'editor');
  const canMarkStaleRuns = canAtLeast(currentRole, 'admin');
  const canCreateRegressionCase = canAtLeast(currentRole, 'editor');
  const incidentItems = useMemo(
    () => (incidents.data?.queues || []).flatMap((queue) => (
      queue.items.map((item) => ({ ...item, queue_label: queue.label, queue_key: queue.key }))
    )),
    [incidents.data?.queues],
  );

  const runRecovery = useQuery({
    queryKey: ['run-recovery', activeRun?.id || 'none'],
    queryFn: () => api.getRunRecovery(activeRun?.id || '', 5),
    enabled: Boolean(activeRun?.id),
  });

  const activeEvents = useMemo(() => (
    runEvents.data?.length ? runEvents.data : activeRun?.events || []
  ), [activeRun?.events, runEvents.data]);
  const activeLlmLogs = runEvidence.data?.llm_logs || [];
  const activeToolAudits = runEvidence.data?.tool_audits || [];
  const activeKnowledgeAudits = runEvidence.data?.knowledge_audits || [];
  const activeLlmLogSummary = llmLogSummary(activeLlmLogs);
  const activeMetrics = activeRun ? runSummary(activeRun) : [];
  const activeManifestSummary = activeRun ? manifestSummary(activeRun) : null;
  const activeLlmContracts = runLlmContracts(activeRun);
  const activeToolAuditSummary = toolAuditSummary(activeToolAudits);
  const activeKnowledgeAuditSummary = knowledgeAuditSummary(activeKnowledgeAudits);
  const activeFailureItems = useMemo(
    () => failureEvidenceItems(activeEvents, activeRun),
    [activeEvents, activeRun],
  );
  const activeHandoffItems = useMemo(
    () => subagentHandoffItems(activeEvents),
    [activeEvents],
  );
  const activeReplayPayload = useMemo(
    () => JSON.stringify(runEvidence.data?.replay_request || {}, null, 2),
    [runEvidence.data?.replay_request],
  );
  const activeRuntimeSnapshot = useMemo(
    () => JSON.stringify(runEvidence.data?.runtime_snapshot || {}, null, 2),
    [runEvidence.data?.runtime_snapshot],
  );

  const tracePhaseOptions = useMemo(() => (
    Object.entries(phaseLabels)
      .filter(([phase]) => activeEvents.some((event) => event.phase === phase))
      .map(([value, label]) => ({ value, label }))
  ), [activeEvents]);
  const traceStatusOptions = useMemo(() => (
    Array.from(new Set(activeEvents.map((event) => event.status)))
      .map((value) => ({ value, label: traceStatusLabels[value] || value }))
  ), [activeEvents]);
  const traceResourceOptions = useMemo(() => (
    Array.from(new Set(activeEvents.flatMap((event) => [event.resource, event.subagent].filter(Boolean) as string[])))
      .map((value) => ({ value, label: value }))
  ), [activeEvents]);
  const filteredEvents = useMemo(() => (
    activeEvents.filter((event) => (
      (!tracePhase || event.phase === tracePhase)
      && (!traceStatus || event.status === traceStatus)
      && (!traceResource || event.resource === traceResource || event.subagent === traceResource)
    ))
  ), [activeEvents, tracePhase, traceResource, traceStatus]);
  const firstFailureEvent = useMemo(() => (
    activeEvents.find((event) => event.phase === 'error' || event.status === 'error')
  ), [activeEvents]);
  const hasTraceFilter = Boolean(tracePhase || traceStatus || traceResource);
  const openRunEvidence = (key: EvidenceIndexKey, tone?: string) => {
    if (key === 'output') {
      setActiveRunTab('io');
      return;
    }
    if (key === 'trace') {
      setActiveRunTab('trace');
      setTracePhase(undefined);
      setTraceStatus(tone === 'danger' ? 'error' : undefined);
      setTraceResource(undefined);
      return;
    }
    if (key === 'tools') {
      setActiveRunTab('trace');
      setTracePhase('tool');
      setTraceStatus(tone === 'danger' ? 'error' : undefined);
      setTraceResource(undefined);
      return;
    }
    setActiveRunTab('audit');
  };
  const firstFailureItem = activeFailureItems[0];
  const failureDetail = activeRun && (activeRun.status === 'failed' || activeRun.status === 'blocked' || activeRun.error || firstFailureEvent || activeFailureItems.length)
    ? {
        phase: firstFailureItem?.phase || (firstFailureEvent ? (phaseLabels[firstFailureEvent.phase] || firstFailureEvent.phase) : '运行'),
        label: firstFailureItem?.label || visibleRuntimeText(firstFailureEvent?.label || firstFailureEvent?.type || '运行失败'),
        resource: firstFailureItem?.resource || visibleRuntimeText(eventText(firstFailureEvent?.resource || firstFailureEvent?.subagent)),
        message: firstFailureItem?.message || activeRun.error || '没有记录详细错误信息',
      }
    : null;
  const evidenceIndexItems = activeRun ? [
    {
      key: 'output',
      label: '输出证据',
      value: activeRun.output_text || activeRun.output_preview ? 1 : 0,
      hint: activeRun.output_preview || activeRun.output_text || (activeRun.status === 'running' ? '等待服务输出' : '未记录输出摘要'),
      tone: activeRun.status === 'completed' ? 'default' : activeRun.status === 'running' ? 'warning' : 'danger',
    },
    {
      key: 'knowledge',
      label: '资料依据',
      value: activeKnowledgeAuditSummary.retrieved,
      hint: `${activeKnowledgeAudits.length} 次检索，${formatNumber(activeKnowledgeAuditSummary.indexed)} 个索引片段`,
      tone: 'default',
    },
    {
      key: 'tools',
      label: `${productTerms.action}记录`,
      value: activeToolAuditSummary.total,
      hint: activeToolAuditSummary.failed ? `${activeToolAuditSummary.failed} 条失败` : `${productTerms.action}输入、输出与权限上下文`,
      tone: activeToolAuditSummary.failed ? 'danger' : 'default',
    },
    {
      key: 'trace',
      label: '异常线索',
      value: activeEvents.length,
      hint: failureDetail ? `${failureDetail.phase}阶段存在异常` : '未发现异常事件，可查看完整执行过程',
      tone: failureDetail ? 'danger' : 'default',
    },
  ] : [];
  const evidenceFlowItems = activeRun ? [
    {
      key: 'entrypoint',
      label: '执行协议',
      value: activeEntrypointMeta?.name || entrypointMeta[activeRun.entrypoint || '']?.label || '存量入口',
      hint: activeTriggerMeta ? `${activeTriggerMeta.name} · ${activeTriggerMeta.path}` : '触发来源待确认',
      state: 'ready',
    },
    {
      key: 'model',
      label: '模型',
      value: activeRun.model || '-',
      hint: activeLlmLogSummary.calls ? `${formatNumber(activeLlmLogSummary.calls)} 次调用${activeLlmLogSummary.failures ? ` / ${activeLlmLogSummary.failures} 次失败` : ''}` : '等待模型调用证据',
      state: activeLlmLogSummary.failures ? 'danger' : 'ready',
    },
    {
      key: 'tool',
      label: '工具',
      value: `${formatNumber(activeToolAuditSummary.total)} 次`,
      hint: activeToolAuditSummary.failed ? `${activeToolAuditSummary.failed} 次失败` : '权限与输入输出已入证据',
      state: activeToolAuditSummary.failed ? 'danger' : activeToolAuditSummary.total ? 'ready' : 'muted',
      onClick: () => openRunEvidence('tools', activeToolAuditSummary.failed ? 'danger' : undefined),
    },
    {
      key: 'knowledge',
      label: '知识资料',
      value: `${formatNumber(activeKnowledgeAuditSummary.retrieved)} 片段`,
      hint: activeKnowledgeAudits.length ? `${activeKnowledgeAudits.length} 次召回` : '未召回知识资料',
      state: activeKnowledgeAuditSummary.retrieved ? 'ready' : 'muted',
      onClick: () => openRunEvidence('knowledge'),
    },
    {
      key: 'output',
      label: failureDetail ? '异常' : '输出',
      value: failureDetail ? failureDetail.phase : runStatusMeta[activeRun.status]?.label || activeRun.status,
      hint: failureDetail?.message || activeRun.output_preview || activeRun.output_text || '等待输出',
      state: failureDetail ? 'danger' : activeRun.status === 'running' ? 'warning' : 'ready',
      onClick: () => openRunEvidence(failureDetail ? 'trace' : 'output', failureDetail ? 'danger' : undefined),
    },
  ] : [];

  const openIncidents = (incidents.data?.queues || []).reduce((sum, queue) => sum + queue.count, 0);
  const blockedIncidents = (incidents.data?.queues || []).find((queue) => queue.key === 'blocked')?.count || 0;
  const runCommandTone = openIncidents ? 'blocked' : (stats.data?.running_runs || 0) ? 'warning' : 'ready';
  const runCommandLabel = runCommandTone === 'blocked' ? '待处理' : runCommandTone === 'warning' ? '运行中' : '平稳';
  const activeRunHasInput = Boolean(activeRun?.input_text || activeRun?.input_preview);
  const activePrimaryAction = activeRun?.status === 'running'
    ? 'cancel'
    : activeRun?.status === 'completed'
      ? 'case'
      : 'rerun';

  const rerunMutation = useMutation({
    mutationFn: (runId: string) => api.rerunRun(runId),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['run-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['run-recovery'] });
      queryClient.invalidateQueries({ queryKey: ['run-evidence'] });
      queryClient.invalidateQueries({ queryKey: ['run-events'] });
      queryClient.invalidateQueries({ queryKey: ['tool-audits', 'run', run.id] });
      setSelectedRun(run);
      toast.success('已完成重跑');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '重跑失败');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (runId: string) => api.cancelRun(runId),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['run-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['run-recovery'] });
      queryClient.invalidateQueries({ queryKey: ['run-evidence'] });
      queryClient.invalidateQueries({ queryKey: ['run-events'] });
      setSelectedRun(run);
      toast.success('运行已取消');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '取消运行失败');
    },
  });

  const markStaleMutation = useMutation({
    mutationFn: () => api.markStaleRuns({ olderThanMinutes: 120, limit: 100 }),
    onSuccess: (rows) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['run-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['run-recovery'] });
      queryClient.invalidateQueries({ queryKey: ['run-evidence'] });
      queryClient.invalidateQueries({ queryKey: ['run-events'] });
      toast.success(rows.length ? `已标记 ${rows.length} 条超时运行` : '没有需要标记的超时运行');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '超时标记失败');
    },
  });

  const createRegressionCase = useMutation({
    mutationFn: (run: AgentRun) => api.createTestCaseFromRun(run.id),
    onSuccess: (testCase) => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', testCase.agent_id] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast.success(`已保存为验收用例：${testCase.name}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存验收用例失败');
    },
  });

  const selectRunById = async (runId: string) => {
    const cachedRun = (runs.data || []).find((run) => run.id === runId);
    if (cachedRun) {
      setSelectedRun(cachedRun);
      return;
    }
    try {
      const run = await queryClient.fetchQuery({
        queryKey: ['run', runId],
        queryFn: () => api.getRun(runId),
      });
      setSelectedRun(run);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载运行详情失败');
    }
  };

  const selectIncidentRun = (item: RunIncidentItem) => selectRunById(item.run_id);
  const copyText = (value: string, label: string) => {
    navigator.clipboard?.writeText(value || '').then(() => toast.success(`${label}已复制`));
  };
  const openStudio = () => {
    window.history.pushState({}, '', '/agents');
    window.dispatchEvent(new Event('popstate'));
  };

  const renderRerunAction = (primary = false) => (
    <Button
      variant={primary ? 'default' : 'outline'}
      size="sm"
      disabled={!activeRun || !canRerunRun || rerunMutation.isPending}
      title={canRerunRun ? '使用相同输入和上线版本证据复验' : '需编辑权限'}
      onClick={() => activeRun && rerunMutation.mutate(activeRun.id)}
    >
      <RotateCcw className="size-3.5" />
      按原版本复验
    </Button>
  );

  const renderCreateCaseAction = (primary = false) => (
    <Button
      variant={primary ? 'default' : 'outline'}
      size="sm"
      disabled={!activeRun || !canCreateRegressionCase || !activeRunHasInput || createRegressionCase.isPending}
      title={canCreateRegressionCase ? '从当前运行输入和输出摘要生成验收样本' : '需编辑权限'}
      onClick={() => activeRun && createRegressionCase.mutate(activeRun)}
    >
      <FlaskConical className="size-3.5" />
      沉淀验收样本
    </Button>
  );

  const renderCancelAction = (primary = false) => (
    <Confirm
      title="终止这次运行？"
      description="终止会把当前执行中的运行标记为已取消；流式请求会在下一次事件检查时停止。"
      disabled={!activeRun || !canCancelRun || activeRun.status !== 'running'}
      okText="终止运行"
      cancelText="保留运行"
      onConfirm={() => activeRun && cancelMutation.mutate(activeRun.id)}
    >
      <Button
        variant={primary ? 'destructive' : 'outline'}
        size="sm"
        disabled={!activeRun || !canCancelRun || activeRun.status !== 'running' || cancelMutation.isPending}
        title={canCancelRun ? '终止运行' : '需编辑权限'}
        className={!primary ? 'border-destructive/40 text-destructive hover:bg-destructive/10' : ''}
      >
        <XCircle className="size-3.5" />
        终止运行
      </Button>
    </Confirm>
  );

  useEffect(() => {
    if (!selectedRun && runs.data?.[0]) {
      setSelectedRun(runs.data[0]);
    }
  }, [runs.data, selectedRun]);

  useEffect(() => {
    setTracePhase(undefined);
    setTraceStatus(undefined);
    setTraceResource(undefined);
    setActiveRunTab('diagnosis');
  }, [activeRun?.id]);

  // ---- Evidence flow node style helper ----
  const flowNodeClass = (state: string) => {
    if (state === 'danger') return 'border-destructive/40 bg-destructive/5 text-destructive';
    if (state === 'warning') return 'border-warning/40 bg-warning/5 text-warning';
    if (state === 'muted') return 'border-border bg-muted/30 text-muted-foreground';
    return 'border-border bg-card';
  };

  // ---- Verdict card style ----
  const verdictTone = failureDetail ? 'danger' : activeRun?.status === 'running' ? 'warning' : 'ready';
  const verdictClass = verdictTone === 'danger'
    ? 'border-destructive/30 bg-destructive/5'
    : verdictTone === 'warning'
      ? 'border-warning/30 bg-warning/5'
      : 'border-success/30 bg-success/5';

  // ---- Tabs content ----
  const diagnosisTab = activeRun ? (
    <div className="space-y-4">
      {/* Verdict card */}
      <div className={`rounded-xl border p-4 space-y-2 ${verdictClass}`}>
        <div className="flex items-center gap-2">
          {failureDetail
            ? <XCircle className="size-4 text-destructive shrink-0" />
            : activeRun.status === 'running'
              ? <LayoutDashboard className="size-4 text-warning shrink-0" />
              : <CheckCircle2 className="size-4 text-success shrink-0" />}
          <span className="text-sm font-semibold">{statusDomainLabel(activeRun, failureDetail?.label)}</span>
        </div>
        <p className="font-semibold text-sm">
          {failureDetail?.message || activeRun.error || (activeRun.status === 'completed' ? '运行已完成，未发现异常事件。' : '等待更多运行事件。')}
        </p>
        <p className="text-xs text-muted-foreground">
          {activeRun.status === 'running'
            ? '保持观察；如超过预期时长，可由编辑者终止现场。'
            : failureDetail
              ? '先定位失败阶段；必要时按原版本复验，并把有效样本沉淀为验收资产。'
              : `可复核业务输入、输出结果、${productTerms.action}记录和${productTerms.businessMaterial}依据。`}
        </p>
        <div className="flex items-center gap-2 pt-1 border-t border-border/50">
          <span className="text-xs text-muted-foreground">下一步</span>
          <span className="text-xs font-semibold">{runNextActionLabel(activeRun, failureDetail)}</span>
        </div>
      </div>

      {/* Evidence index */}
      <div className="grid grid-cols-2 gap-2" aria-label="证据索引">
        {evidenceIndexItems.map((item) => (
          <button
            type="button"
            key={item.key}
            className={`rounded-lg border p-3 text-left space-y-1 transition-colors hover:bg-accent/40 ${
              item.tone === 'danger' ? 'border-destructive/30 bg-destructive/5' :
              item.tone === 'warning' ? 'border-warning/30 bg-warning/5' :
              'border-border bg-card'
            }`}
            onClick={() => openRunEvidence(item.key as EvidenceIndexKey, item.tone)}
          >
            <span className="block text-xs text-muted-foreground">{item.label}</span>
            <strong className="block text-lg font-bold">{formatNumber(item.value)}</strong>
            <em className="block text-xs not-italic text-muted-foreground truncate">{item.hint}</em>
          </button>
        ))}
      </div>

      {/* Evidence flow */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="运行证据链">
        <div className="flex items-center justify-between">
          <strong className="text-sm font-semibold">证据链</strong>
          <span className="text-xs text-muted-foreground">{activeEvents.length ? `${activeEvents.length} 个事件` : '暂无事件'}</span>
        </div>
        <div className="flex flex-col gap-2">
          {evidenceFlowItems.map((item) => {
            const content = (
              <>
                <span className="block text-xs text-muted-foreground">{item.label}</span>
                <strong className="block text-sm font-semibold truncate">{item.value}</strong>
                <em className="block text-xs not-italic text-muted-foreground truncate">{item.hint}</em>
              </>
            );
            const cls = `rounded-lg border p-3 space-y-0.5 ${flowNodeClass(item.state)} ${'onClick' in item ? 'cursor-pointer transition-colors hover:bg-accent/40' : ''}`;
            return 'onClick' in item ? (
              <button type="button" className={cls} key={item.key} onClick={item.onClick}>{content}</button>
            ) : (
              <div className={cls} key={item.key}>{content}</div>
            );
          })}
        </div>
      </div>

      {/* Run metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        {activeMetrics.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-card px-3 py-2 space-y-0.5">
            <span className="block text-xs text-muted-foreground">{item.label}</span>
            <strong className="block text-sm font-semibold">{item.value}</strong>
          </div>
        ))}
      </div>

      {/* Failure chain */}
      {activeFailureItems.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <strong className="text-sm font-semibold text-destructive">失败链路</strong>
            <span className="text-xs text-muted-foreground">{activeFailureItems.length} 条异常证据</span>
          </div>
          <div className="space-y-2">
            {activeFailureItems.map((item, index) => (
              <article key={item.key} className="rounded-lg border border-destructive/20 bg-background p-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={index === 0 ? 'destructive' : 'warning'}>{index === 0 ? '首个异常' : '后续异常'}</Badge>
                  <strong className="text-sm">{item.phase} · {item.label}</strong>
                  {item.seq > 0 && <span className="text-xs text-muted-foreground">#{item.seq}</span>}
                </div>
                <p className="text-sm text-foreground">{item.message}</p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {item.resource && <span>资源：{item.resource}</span>}
                  {item.callId && <span>调用：{shortCallId(item.callId)}</span>}
                  {item.timestamp && <span>{formatDate(item.timestamp)}</span>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* Subagent handoffs */}
      {activeHandoffItems.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <strong className="text-sm font-semibold">{productTerms.workRole}交接</strong>
            <span className="text-xs text-muted-foreground">{activeHandoffItems.length} 次</span>
          </div>
          <div className="space-y-2">
            {activeHandoffItems.map((item) => (
              <article key={item.key} className={`rounded-lg border p-3 space-y-1.5 ${item.status === 'error' ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-background'}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <strong className="text-sm">{item.from} → {item.to}</strong>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={item.status === 'error' ? 'destructive' : item.status === 'success' ? 'success' : 'outline'}>
                      {traceStatusLabels[item.status] || item.status}
                    </Badge>
                    {item.durationMs > 0 && <Badge variant="outline">{formatDuration(item.durationMs)}</Badge>}
                  </div>
                </div>
                {item.task && <p className="text-sm text-muted-foreground">{item.task}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">交接输入</summary>
                    <pre className="mt-1 rounded bg-muted/60 p-2 text-xs overflow-x-auto">{item.input || item.task || '-'}</pre>
                  </details>
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">返回结果</summary>
                    <pre className="mt-1 rounded bg-muted/60 p-2 text-xs overflow-x-auto">{item.output || '-'}</pre>
                  </details>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1 border-t border-border/50">
                  {item.seq > 0 && <span>事件 #{item.seq}</span>}
                  {item.parentSeq > 0 && <span>父事件 #{item.parentSeq}</span>}
                  {item.callId && <span>调用 {shortCallId(item.callId)}</span>}
                  {item.timestamp && <span>{formatDate(item.timestamp)}</span>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* Recovery verification */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <strong className="text-sm font-semibold">恢复验证</strong>
          <span className="text-xs text-muted-foreground">
            {runRecovery.isFetching ? '加载中' : runRecovery.data ? `${runRecovery.data.rerun_count || 0} 次重跑` : '无重跑记录'}
          </span>
        </div>
        {runRecovery.data ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={runRecovery.data.status} />
              <strong className="text-sm">{runRecovery.data.verdict || '等待复验结果'}</strong>
              <span className="text-xs text-muted-foreground">{runRecovery.data.rerun_count ? `${runRecovery.data.rerun_count} 次重跑` : '暂无重跑'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button"
                className="rounded-lg border border-border bg-background p-3 text-left space-y-0.5 hover:bg-accent/40 transition-colors"
                onClick={() => selectRunById(runRecovery.data.source_run.run_id)}>
                <span className="block text-xs text-muted-foreground">来源运行</span>
                <strong className="block text-sm font-semibold">{shortRunId(runRecovery.data.source_run.run_id)}</strong>
                <em className="block text-xs not-italic text-muted-foreground">{recoverySnapshotLabel(runRecovery.data.source_run)}</em>
              </button>
              <button type="button"
                disabled={!runRecovery.data.latest_rerun}
                className="rounded-lg border border-border bg-background p-3 text-left space-y-0.5 hover:bg-accent/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => runRecovery.data.latest_rerun && selectRunById(runRecovery.data.latest_rerun.run_id)}>
                <span className="block text-xs text-muted-foreground">最近重跑</span>
                <strong className="block text-sm font-semibold">{shortRunId(runRecovery.data.latest_rerun?.run_id)}</strong>
                <em className="block text-xs not-italic text-muted-foreground">{recoverySnapshotLabel(runRecovery.data.latest_rerun)}</em>
              </button>
            </div>
            {runRecovery.data.latest_rerun && (
              <div className="grid grid-cols-4 gap-2">
                {recoveryDeltaItems(runRecovery.data.deltas).map((item) => (
                  <div key={item.label} className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                    <strong className="block text-sm font-bold">{item.value}</strong>
                    <span className="block text-xs text-muted-foreground">{item.label}变化</span>
                  </div>
                ))}
              </div>
            )}
            {runRecovery.data.candidates.length > 0 && (
              <div className="space-y-1">
                {runRecovery.data.candidates.slice(0, 4).map((candidate) => (
                  <button key={candidate.run_id} type="button"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-left flex items-center gap-2 hover:bg-accent/40 transition-colors"
                    onClick={() => selectRunById(candidate.run_id)}>
                    {runStatusTag(candidate.status)}
                    <strong className="text-sm flex-shrink-0">{shortRunId(candidate.run_id)}</strong>
                    <span className="text-xs text-muted-foreground truncate">{candidate.output_preview || candidate.error_preview || formatDate(candidate.started_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">暂无恢复验证数据。</p>
        )}
      </div>
    </div>
  ) : null;

  const traceTab = activeRun ? (
    <div className="space-y-4">
      {/* Trace filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={tracePhase || ''} onValueChange={(v) => setTracePhase(v as RunTraceEvent['phase'] || undefined)}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue placeholder="阶段" />
          </SelectTrigger>
          <SelectContent>
            {tracePhaseOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={traceStatus || ''} onValueChange={(v) => setTraceStatus(v as RunTraceEvent['status'] || undefined)}>
          <SelectTrigger className="w-28 h-8 text-xs">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            {traceStatusOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={traceResource || ''} onValueChange={(v) => setTraceResource(v || undefined)}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder={`资源/${productTerms.workRole}`} />
          </SelectTrigger>
          <SelectContent>
            {traceResourceOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 flex-wrap">
          <Button size="sm" variant="outline" className="h-8 text-xs px-2.5"
            onClick={() => { setTracePhase(undefined); setTraceStatus('error'); setTraceResource(undefined); }}>
            只看错误
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs px-2.5"
            onClick={() => { setTracePhase('tool'); setTraceStatus(undefined); setTraceResource(undefined); }}>
            {productTerms.action}
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs px-2.5"
            onClick={() => { setTracePhase('subagent'); setTraceStatus(undefined); setTraceResource(undefined); }}>
            {productTerms.workRole}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs px-2.5"
            disabled={!hasTraceFilter}
            onClick={() => { setTracePhase(undefined); setTraceStatus(undefined); setTraceResource(undefined); }}>
            全部
          </Button>
        </div>
      </div>

      {/* Event stream */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <strong className="text-sm font-semibold">事件流</strong>
          <span className="text-xs text-muted-foreground">
            {activeEvents.length
              ? hasTraceFilter
                ? `${filteredEvents.length}/${activeEvents.length} 条`
                : `${activeEvents.length} 条`
              : '暂无事件'}
          </span>
        </div>
        {filteredEvents.length ? (
          <div className="space-y-2">
            {filteredEvents.map((event, index) => (
              <div key={`${event.seq || index}-${event.type}-${event.timestamp || ''}`}>
                {renderEvent(event, index)}
              </div>
            ))}
          </div>
        ) : activeEvents.length ? (
          <EmptyState compact description="当前过滤条件下没有运行记录" />
        ) : (
          <EmptyState compact description="这次运行没有记录运行过程" />
        )}
      </div>
    </div>
  ) : null;

  const ioTab = activeRun ? (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <strong className="text-sm font-semibold">业务输入</strong>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
              onClick={() => copyText(activeRun.input_text || activeRun.input_preview || '', '输入')}>
              <Clipboard className="size-3" />
              复制
            </Button>
          </div>
          <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">
            {activeRun.input_text || activeRun.input_preview || '-'}
          </pre>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <strong className="text-sm font-semibold">交付输出</strong>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
              onClick={() => copyText(activeRun.output_text || activeRun.output_preview || '', '输出')}>
              <Clipboard className="size-3" />
              复制
            </Button>
          </div>
          <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">
            {activeRun.output_text || activeRun.output_preview || '-'}
          </pre>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <strong className="text-sm font-semibold">Responses 重放请求</strong>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
            onClick={() => copyText(activeReplayPayload, '重放请求')}>
            <Clipboard className="size-3" />
            复制
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">用于复现同一次业务输入；正式复验以后端保存的上线版本快照为准。</p>
        <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto">{activeReplayPayload}</pre>
      </div>

      {activeFailureItems.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <strong className="text-sm font-semibold text-destructive">异常摘要</strong>
            <span className="text-xs text-muted-foreground">{activeFailureItems.length} 条</span>
          </div>
          <div className="space-y-2">
            {activeFailureItems.map((item) => (
              <article key={item.key} className="rounded-lg border border-destructive/20 bg-background p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <strong className="text-sm">{item.phase} · {item.label}</strong>
                  {item.seq > 0 && <span className="text-xs text-muted-foreground">#{item.seq}</span>}
                </div>
                <p className="text-sm text-foreground">{item.message}</p>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : null;

  const auditTab = activeRun ? (
    <div className="space-y-4">
      {/* LLM logs */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <strong className="text-sm font-semibold">模型调用</strong>
          <span className="text-xs text-muted-foreground">
            {runEvidence.isFetching ? '加载中' : `${activeLlmLogs.length} 条`}
          </span>
        </div>
        {activeLlmLogs.length > 0 ? (
          <>
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                <strong className="block text-base font-bold">{activeLlmLogSummary.calls}</strong>
                <span className="block text-xs text-muted-foreground">调用</span>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                <strong className="block text-base font-bold">{formatNumber(activeLlmLogSummary.tokens)}</strong>
                <span className="block text-xs text-muted-foreground">Token</span>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                <strong className="block text-base font-bold">{activeLlmLogSummary.firstToken ? `${activeLlmLogSummary.firstToken}ms` : '-'}</strong>
                <span className="block text-xs text-muted-foreground">首响应</span>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                <strong className="block text-base font-bold">{activeLlmLogSummary.failures}</strong>
                <span className="block text-xs text-muted-foreground">失败记录</span>
              </div>
            </div>
            {activeLlmLogSummary.actors.size > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {Array.from(activeLlmLogSummary.actors.values()).slice(0, 4).map((item) => (
                  <div key={`${item.actor}-${item.model}`} className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
                    <strong className="block text-xs font-semibold">{formatNumber(item.tokens)}</strong>
                    <span className="block text-xs text-muted-foreground">
                      {item.actor}
                      {' · '}
                      {item.model}
                      {' · '}
                      {formatNumber(item.calls)} 次
                      {' · '}
                      {formatNumber(item.inputTokens)} / {formatNumber(item.outputTokens)} Token
                      {item.failures > 0 ? ` · ${item.failures} 失败` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              {activeLlmLogs.slice(0, 6).map((record) => (
                <div key={record.id} className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={record.status === 'failed' || record.error ? 'destructive' : 'success'}>
                      {record.status === 'failed' || record.error ? '失败' : '成功'}
                    </Badge>
                    <Badge variant={llmActorVariant(record)}>{llmActorLabel(record)}</Badge>
                    <Badge variant="outline">{formatNumber(record.llm_calls || 0)} 次</Badge>
                    <span className="text-xs text-muted-foreground">{record.provider_type}</span>
                    <span className="text-xs text-muted-foreground">{record.model}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(record.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(record.input_tokens)} / {formatNumber(record.output_tokens)} / {formatNumber(record.total_tokens)} Token
                    {record.duration_ms ? ` · ${record.duration_ms} ms` : ''}
                  </p>
                  {record.error && <em className="block text-xs text-destructive not-italic">{record.error}</em>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">当前运行没有模型调用记录。</p>
        )}
      </div>

      {/* Tool audits */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <strong className="text-sm font-semibold">{productTerms.action}调用</strong>
          <span className="text-xs text-muted-foreground">
            {runEvidence.isFetching ? '加载中' : `${activeToolAudits.length} 条`}
          </span>
        </div>
        {activeToolAudits.length > 0 ? (
          <div className="space-y-2">
            {activeToolAudits.map((record) => (
              <article key={record.id} className="rounded-lg border border-border bg-background p-3 space-y-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="space-y-0.5 min-w-0">
                    <strong className="block text-sm font-semibold">{record.tool_id}</strong>
                    <span className="block text-xs text-muted-foreground">
                      {record.implementation}
                      {record.method ? ` · ${record.method}` : ''}
                      {record.call_id ? ` · 调用 ${shortCallId(record.call_id)}` : ' · 无调用 ID'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusTag status={record.status} />
                    <Badge variant={auditSourceVariant(record.source)}>{auditSourceLabel(record.source)}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded bg-muted/40 px-2.5 py-1.5">
                  <span className="text-xs font-mono font-medium">{record.method || 'METHOD'}</span>
                  <code className="text-xs text-muted-foreground truncate">{record.url || record.tool_id}</code>
                </div>
                {record.error && (
                  <p className="text-xs text-destructive rounded bg-destructive/5 px-2 py-1">{record.error}</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">请求</summary>
                    <pre className="mt-1 rounded bg-muted/60 p-2 text-xs overflow-x-auto">{record.request_preview || '-'}</pre>
                  </details>
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">响应</summary>
                    <pre className="mt-1 rounded bg-muted/60 p-2 text-xs overflow-x-auto">{record.response_preview || record.error || '-'}</pre>
                  </details>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50 text-xs text-muted-foreground">
                  <span>{record.duration_ms || 0}ms</span>
                  <span>{formatDate(record.created_at)}</span>
                  <span>{shortAuditUser(record.user_id)}</span>
                  {record.actor_role && (
                    <Badge variant={isOrganizationRole(record.actor_role) ? 'info' : 'outline'}>
                      {isOrganizationRole(record.actor_role) ? roleLabels[record.actor_role] : record.actor_role}
                    </Badge>
                  )}
                  {(record.run_id || record.agent_id || record.conversation_id) && (
                    <Tooltip content={
                      <div className="space-y-0.5">
                        {record.run_id && <div>运行: {record.run_id}</div>}
                        {record.agent_id && <div>服务: {record.agent_id}</div>}
                        {record.conversation_id && <div>执行上下文: {record.conversation_id}</div>}
                      </div>
                    }>
                      <span className="inline-flex cursor-help rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">上下文</span>
                    </Tooltip>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState compact description={`这次运行没有${productTerms.action}运行证据`} />
        )}
      </div>

      {/* Knowledge audits */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <strong className="text-sm font-semibold">{productTerms.businessMaterial}召回</strong>
          <span className="text-xs text-muted-foreground">
            {runEvidence.isFetching ? '加载中' : `${activeKnowledgeAudits.length} 条`}
          </span>
        </div>
        {activeKnowledgeAudits.length > 0 ? (
          <>
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                <strong className="block text-base font-bold">{activeKnowledgeAudits.length}</strong>
                <span className="block text-xs text-muted-foreground">检索</span>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                <strong className="block text-base font-bold">{activeKnowledgeAuditSummary.retrieved}</strong>
                <span className="block text-xs text-muted-foreground">召回片段</span>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                <strong className="block text-base font-bold">{activeKnowledgeAuditSummary.indexed}</strong>
                <span className="block text-xs text-muted-foreground">索引片段</span>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                <strong className="block text-base font-bold">{Array.from(activeKnowledgeAuditSummary.sources).join('/') || '-'}</strong>
                <span className="block text-xs text-muted-foreground">索引来源</span>
              </div>
            </div>
            <div className="space-y-2">
              {activeKnowledgeAudits.slice(0, 3).map((record) => (
                <div key={record.id} className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="info">{record.index_source || 'unknown'}</Badge>
                    <span className="text-xs text-muted-foreground">{record.retrieved_chunks}/{record.indexed_chunks} 片段</span>
                    <span className="text-xs text-muted-foreground">{formatDate(record.created_at)}</span>
                  </div>
                  <p className="text-sm text-foreground">{record.query_preview || '-'}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {record.chunk_refs.slice(0, 3).map((chunk) => (
                      <Tooltip
                        key={chunk.chunk_id || `${chunk.document_id}-${chunk.ordinal}`}
                        content={chunk.preview || chunk.content_hash}
                      >
                        <Badge variant="outline" className="cursor-help">
                          {chunk.file_name}#{chunk.ordinal + 1}
                        </Badge>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">当前运行没有业务资料召回证据。</p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <WorkspacePage
      icon={<LayoutDashboard size={14} />}
      eyebrow="运营"
      title="运行证据"
      description={`面向已上线 ${productTerms.agentService} 的执行复盘、证据链、${productTerms.tool} 调用、模型调用和复验闭环。`}
    >
      {/* Workspace summary */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">运行证据状态</h2>
          <p className="text-xs text-muted-foreground">后端聚合运行指标和事故队列，前端保留 Trace、Tool、Knowledge、LLM 合约细节浏览。</p>
        </div>
        <WorkspaceMetricGrid items={workspace.data?.metrics || []} />
        <WorkspaceIssueList items={workspace.data?.issues || []} emptyLabel="当前没有高优先级运行事件。" />
      </div>

      {/* Run ops strip */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-wrap items-center justify-between gap-4" aria-label="运行总览">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge
              variant={runCommandTone === 'blocked' ? 'destructive' : runCommandTone === 'warning' ? 'warning' : 'success'}
            >
              {runCommandLabel}
            </Badge>
          </div>
          <h2 className="text-sm font-semibold">
            {openIncidents
              ? `${formatNumber(openIncidents)} 个运行事件待处置`
              : activeRun
                ? `${activeRun.agent_name || activeRun.agent_id} 的当前现场`
                : '暂无运行证据'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {openIncidents
              ? `近 24 小时：${formatNumber(blockedIncidents)} 阻断 / ${formatNumber(stats.data?.failed_runs || 0)} 失败 / ${formatNumber(stats.data?.stale_runs || 0)} 超时 / ${formatNumber(stats.data?.cancelled_runs || 0)} 取消`
              : activeRun
                ? `${runStatusMeta[activeRun.status]?.label || activeRun.status} · ${formatDate(activeRun.started_at)} · ${activeRun.duration_ms ? formatDuration(activeRun.duration_ms) : '未记录耗时'}`
                : '等待运行记录'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {[
            { label: '待处置', value: openIncidents, hint: '运行事件', danger: !!openIncidents },
            { label: '运行中', value: stats.data?.running_runs || 0, hint: '现场执行', warn: !!(stats.data?.running_runs || 0) },
            { label: '失败', value: stats.data?.failed_runs || 0, hint: '需复验' },
            { label: '超时', value: stats.data?.stale_runs || 0, hint: '待确认' },
          ].map((s) => (
            <div key={s.label} className={`text-center px-3 py-1.5 rounded-lg border ${s.danger ? 'border-destructive/30 bg-destructive/5' : s.warn ? 'border-warning/30 bg-warning/5' : 'border-border bg-muted/30'}`}>
              <span className="block text-xs text-muted-foreground">{s.label}</span>
              <strong className={`block text-lg font-bold ${s.danger ? 'text-destructive' : s.warn ? 'text-warning' : ''}`}>{formatNumber(s.value)}</strong>
              <em className="block text-xs not-italic text-muted-foreground">{s.hint}</em>
            </div>
          ))}
        </div>
      </div>

      {/* Main workbench: 3-column layout */}
      <div className="grid grid-cols-[280px_1fr_260px] gap-4 min-h-[600px]" >
        {/* Left: incident queue + run list */}
        <aside className="flex flex-col gap-3 min-h-0" aria-label="事件队列">
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <strong className="block text-sm font-semibold">事件队列</strong>
                <span className="block text-xs text-muted-foreground">按异常优先级处理生产现场。</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!canMarkStaleRuns || markStaleMutation.isPending}
                title={canMarkStaleRuns ? '标记超过 120 分钟未结束的运行' : '需管理员权限'}
                onClick={() => markStaleMutation.mutate()}
              >
                <Scissors className="size-3.5" />
                标记超时
              </Button>
            </div>

            {/* Incident metrics */}
            <div className="grid grid-cols-4 gap-1.5">
              {(incidents.data?.queues || []).map((queue) => (
                <button
                  type="button"
                  key={queue.key}
                  className={`rounded-lg border p-2 text-center transition-colors hover:bg-accent/40 ${
                    status === incidentQueueStatus(queue.key)
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-muted/30'
                  }`}
                  onClick={() => setStatus(incidentQueueStatus(queue.key))}
                >
                  <strong className="block text-sm font-bold">{formatNumber(queue.count)}</strong>
                  <span className="block text-xs text-muted-foreground truncate">{queue.label}</span>
                </button>
              ))}
            </div>

            {/* Incident list */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(incidents.data?.queues || []).map((queue) => (
                queue.items.length > 0 && (
                  <div key={queue.key} className="space-y-1">
                    <div className="flex items-center justify-between px-1">
                      <strong className="text-xs font-semibold text-foreground">{queue.label}</strong>
                      <span className="text-xs text-muted-foreground">{formatNumber(queue.count)} 条</span>
                    </div>
                    {queue.items.map((item) => (
                      <button
                        type="button"
                        key={item.run_id}
                        className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-left space-y-0.5 hover:bg-accent/40 transition-colors"
                        onClick={() => selectIncidentRun(item)}
                      >
                        <div className="flex items-center gap-1.5">
                          <Badge variant={incidentSeverityVariant(item.severity)}>
                            {runStatusMeta[item.status]?.label || item.status}
                          </Badge>
                        </div>
                        <strong className="block text-xs font-semibold">{item.agent_name || item.agent_id}</strong>
                        <span className="block text-xs text-muted-foreground truncate">{item.reason}</span>
                        <em className="block text-xs not-italic text-muted-foreground truncate">{item.evidence || item.error_preview || item.input_preview || formatDate(item.started_at)}</em>
                      </button>
                    ))}
                  </div>
                )
              ))}
              {!incidents.isLoading && !incidentItems.length && (
                <p className="text-xs text-muted-foreground px-1">近 24 小时没有待处置事件。</p>
              )}
            </div>

            {/* Queue filters */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="relative">
                <Input
                  placeholder={`搜索 ${productTerms.agentService}、异常摘要或业务输入`}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="h-8 text-xs pr-8"
                />
              </div>
              <Select value={agentId || ''} onValueChange={(v) => setAgentId(v || undefined)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Agent" />
                </SelectTrigger>
                <SelectContent>
                  {(agents.data || []).map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status || ''} onValueChange={(v) => setStatus(v || undefined)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">成功</SelectItem>
                  <SelectItem value="blocked">已阻断</SelectItem>
                  <SelectItem value="failed">失败</SelectItem>
                  <SelectItem value="running">运行中</SelectItem>
                  <SelectItem value="cancelled">已取消</SelectItem>
                  <SelectItem value="stale">超时未结束</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Run queue list */}
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {(runs.data || []).map((run) => (
                <button
                  type="button"
                  key={run.id}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left space-y-1 transition-colors hover:bg-accent/40 ${
                    activeRun?.id === run.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-background'
                  }`}
                  onClick={() => setSelectedRun(run)}
                >
                  <div className="flex flex-wrap items-center gap-1">
                    {runStatusTag(run.status)}
                    {runSourceTag(run)}
                    {run.rerun_of_run_id && <Badge variant="default">重跑</Badge>}
                    {(run.derived_run_count || 0) > 0 && <Badge variant="info">已复验</Badge>}
                  </div>
                  <strong className="block text-xs font-semibold truncate">{run.agent_name || run.agent_id}</strong>
                  <span className="block text-xs text-muted-foreground truncate">{run.input_preview || run.input_text || '无输入摘要'}</span>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <em className="not-italic">{formatDuration(run.duration_ms) || (run.status === 'running' ? '运行中' : '即时')}</em>
                    <em className="not-italic">{formatDate(run.started_at)}</em>
                  </div>
                </button>
              ))}
              {!runs.isLoading && !(runs.data || []).length && (
                <EmptyState compact description="暂无运行记录" />
              )}
            </div>
          </div>
        </aside>

        {/* Center: run detail */}
        <section className="min-w-0 flex flex-col gap-3" aria-label="运行详情">
          {activeRun ? (
            <>
              {/* Run case header */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="space-y-0.5">
                  <span className="text-xs text-muted-foreground">当前运行现场</span>
                  <h2 className="text-sm font-semibold">{activeRun.agent_name || activeRun.agent_id}</h2>
                  <p className="text-xs text-muted-foreground">{activeRun.input_preview || activeRun.input_text || '无输入摘要'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {runStatusTag(activeRun.status)}
                  {entrypointTag(activeRun)}
                  {releaseTag(activeRun)}
                  {runSourceTag(activeRun)}
                  {activeRun.rerun_of_run_id && <Badge variant="default">复验</Badge>}
                  {(activeRun.derived_run_count || 0) > 0 && (
                    <Badge variant="info">已复验 {activeRun.derived_run_count}</Badge>
                  )}
                </div>
              </div>

              {/* Protocol strip */}
              <div className="grid grid-cols-5 gap-2" aria-label="运行证据路径">
                {[
                  {
                    label: '执行协议',
                    value: activeEntrypointMeta?.name || entrypointMeta[activeRun.entrypoint || '']?.label || '存量入口',
                    hint: activeEntrypointMeta ? `${activeEntrypointMeta.role} · ${activeEntrypointMeta.path}` : '写入统一运行证据',
                  },
                  {
                    label: '触发入口',
                    value: activeTriggerMeta?.name || runSourceMeta[activeRun.run_source || '']?.label || activeRun.run_source || '运行',
                    hint: activeTriggerMeta ? `${activeTriggerMeta.role} · ${activeTriggerMeta.path}` : '触发来源待确认',
                  },
                  {
                    label: '配置来源',
                    value: runtimeSourceMeta[activeRun.runtime_source || '']?.label || activeRun.runtime_source || '存量记录',
                    hint: activeRun.release_id ? `上线版本 v${activeRun.agent_version || 1}` : '未绑定上线版本',
                  },
                  {
                    label: '版本证据',
                    value: shortHash(activeRun.manifest_hash || activeRun.spec_hash),
                    hint: activeManifestSummary ? `Manifest · ${activeManifestSummary.mainTools} 工具 / ${activeManifestSummary.subagents} 协作角色` : '存量记录未保存清单',
                  },
                  {
                    label: '复验关系',
                    value: activeRun.rerun_of_run_id ? '复验运行' : (activeRun.derived_run_count || 0) > 0 ? '已有复验' : '原始运行',
                    hint: activeRun.rerun_of_run_id ? shortRunId(activeRun.rerun_of_run_id) : `${activeRun.derived_run_count || 0} 条派生运行`,
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-border bg-card p-2.5 space-y-0.5">
                    <span className="block text-xs text-muted-foreground">{item.label}</span>
                    <strong className="block text-xs font-semibold truncate">{item.value}</strong>
                    <em className="block text-xs not-italic text-muted-foreground truncate">{item.hint}</em>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    {activePrimaryAction === 'cancel' && renderCancelAction(true)}
                    {activePrimaryAction === 'case' && renderCreateCaseAction(true)}
                    {activePrimaryAction === 'rerun' && renderRerunAction(true)}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {activePrimaryAction === 'cancel'
                      ? '运行仍在进行，先控制现场。'
                      : activePrimaryAction === 'case'
                        ? '结果可复用时，沉淀为验收样本。'
                        : '使用原上线版本验证异常是否可恢复。'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {activePrimaryAction !== 'rerun' && renderRerunAction(false)}
                  {activePrimaryAction !== 'case' && renderCreateCaseAction(false)}
                  {activePrimaryAction !== 'cancel' && renderCancelAction(false)}
                </div>
              </div>

              {/* Tabs */}
              <div className="rounded-xl border border-border bg-card">
                <Tabs value={activeRunTab} onValueChange={(key) => setActiveRunTab(key as RunTabKey)}>
                  <div className="px-4 pt-2 border-b border-border">
                    <TabsList className="border-b-0 gap-0">
                      <TabsTrigger value="diagnosis">复盘</TabsTrigger>
                      <TabsTrigger value="trace">执行过程</TabsTrigger>
                      <TabsTrigger value="io">业务输入与输出</TabsTrigger>
                      <TabsTrigger value="audit">证据明细</TabsTrigger>
                    </TabsList>
                  </div>
                  <div className="p-4">
                    <TabsContent value="diagnosis">{diagnosisTab}</TabsContent>
                    <TabsContent value="trace">{traceTab}</TabsContent>
                    <TabsContent value="io">{ioTab}</TabsContent>
                    <TabsContent value="audit">{auditTab}</TabsContent>
                  </div>
                </Tabs>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-border bg-card p-8 flex items-center justify-center">
              <EmptyState description="选择一条运行记录查看详情" />
            </div>
          )}
        </section>

        {/* Right: run file panel */}
        <aside className="flex flex-col gap-3 min-h-0 overflow-y-auto" aria-label="复核信息">
          {activeRun ? (
            <>
              {/* Run archive */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <h3 className="text-sm font-semibold">运行档案</h3>
                <div className="space-y-1.5">
                  {[
                    { label: '状态', value: runStatusMeta[activeRun.status]?.label || activeRun.status },
                    { label: productTerms.agentService, value: activeRun.agent_name || activeRun.agent_id },
                    { label: '运行来源', value: runtimeSourceMeta[activeRun.runtime_source || '']?.label || activeRun.runtime_source || '存量记录' },
                    { label: '触发来源', value: runSourceMeta[activeRun.run_source || '']?.label || activeRun.run_source || '运行' },
                    { label: '上线版本', value: activeRun.release_id ? `v${activeRun.agent_version || 1}` : '-' },
                    { label: '来源运行', value: activeRun.rerun_of_run_id ? shortRunId(activeRun.rerun_of_run_id) : '-' },
                    { label: '派生运行', value: String(activeRun.derived_run_count || 0) },
                    { label: '发起时间', value: formatDate(activeRun.started_at) },
                    { label: '结束时间', value: formatDate(activeRun.ended_at) },
                    { label: '耗时', value: activeRun.status === 'running' ? '运行中' : formatDuration(activeRun.duration_ms) },
                    { label: '失败原因', value: failureDetail?.label || activeRun.error || '-' },
                  ].map((item) => (
                    <div key={item.label} className="flex items-start justify-between gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">{item.label}</span>
                      <strong className="font-medium text-right truncate max-w-[130px]">{item.value}</strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Protocol & model details */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <details>
                  <summary className="cursor-pointer text-sm font-semibold hover:text-primary">协议与模型</summary>
                  <div className="mt-2 space-y-1.5">
                    {[
                      { label: '执行协议', value: activeEntrypointMeta?.path || activeRun.entrypoint || '-' },
                      { label: '触发入口', value: activeTriggerMeta?.path || activeRun.run_source || '-' },
                      { label: '模型', value: activeRun.model || '-' },
                      { label: '上线版本 ID', value: activeRun.release_id || '-' },
                      { label: 'Manifest Hash', value: shortHash(activeRun.manifest_hash) },
                      { label: '配置 Hash', value: shortHash(activeRun.spec_hash) },
                    ].map((item) => (
                      <div key={item.label} className="flex items-start justify-between gap-2 text-xs">
                        <span className="text-muted-foreground shrink-0">{item.label}</span>
                        <strong className="font-medium text-right truncate max-w-[130px]">{item.value}</strong>
                      </div>
                    ))}
                  </div>
                  {activeEntrypointMeta && (
                    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                      <h3 className="text-xs font-semibold">执行协议</h3>
                      <div className="flex items-center gap-2">
                        <strong className="text-xs font-semibold">{activeEntrypointMeta.name}</strong>
                        <code className="text-xs text-muted-foreground">{activeEntrypointMeta.path}</code>
                      </div>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        <span>{activeEntrypointMeta.role}</span>
                        <span>·</span>
                        <span>{activeEntrypointMeta.evidence}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{activeEntrypointMeta.note}</p>
                    </div>
                  )}
                  {activeTriggerMeta && (
                    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                      <h3 className="text-xs font-semibold">触发入口</h3>
                      <div className="flex items-center gap-2">
                        <strong className="text-xs font-semibold">{activeTriggerMeta.name}</strong>
                        <code className="text-xs text-muted-foreground">{activeTriggerMeta.path}</code>
                      </div>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        <span>{activeTriggerMeta.role}</span>
                        <span>·</span>
                        <span>{activeTriggerMeta.evidence}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{activeTriggerMeta.note}</p>
                    </div>
                  )}
                </details>
              </div>

              {/* LLM contracts */}
              {activeLlmContracts.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <h3 className="text-sm font-semibold">模型响应路径</h3>
                  <div className="space-y-1.5">
                    {activeLlmContracts.map((item, contractIndex) => (
                      <div key={`${String(item.scope || 'scope')}-${String(item.subagent || contractIndex)}-${String(item.model || contractIndex)}`}
                        className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
                        <strong className="block text-xs font-semibold">{String(item.model || '-')}</strong>
                        <span className="block text-xs text-muted-foreground">
                          {runtimeActorLabel(String(item.scope || 'main'), item.subagent ? String(item.subagent) : undefined)}
                          {' · '}
                          {String(item.provider_type || '-')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence summary */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <h3 className="text-sm font-semibold">证据摘要</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: `${productTerms.action}调用`, value: activeToolAuditSummary.total },
                    { label: `${productTerms.action}失败`, value: activeToolAuditSummary.failed },
                    { label: '模型调用', value: activeLlmLogSummary.calls },
                    { label: '模型失败', value: activeLlmLogSummary.failures },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                      <strong className="block text-sm font-bold">{item.value}</strong>
                      <span className="block text-xs text-muted-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Knowledge summary */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <h3 className="text-sm font-semibold">{productTerms.businessMaterial}召回</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: '检索', value: activeKnowledgeAudits.length },
                    { label: '召回片段', value: activeKnowledgeAuditSummary.retrieved },
                    { label: '索引片段', value: activeKnowledgeAuditSummary.indexed },
                    { label: '索引来源', value: Array.from(activeKnowledgeAuditSummary.sources).join('/') || '-' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                      <strong className="block text-sm font-bold">{item.value}</strong>
                      <span className="block text-xs text-muted-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Manifest summary */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <h3 className="text-sm font-semibold">上线版本证据</h3>
                {activeManifestSummary ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: productTerms.action, value: activeManifestSummary.mainTools },
                        { label: productTerms.capabilityPackage, value: activeManifestSummary.mainSkills },
                        { label: productTerms.workRole, value: activeManifestSummary.subagents },
                        { label: productTerms.businessMaterial, value: activeRun.knowledge_count || 0 },
                      ].map((item) => (
                        <div key={item.label} className="rounded-lg border border-border bg-muted/40 p-2 text-center space-y-0.5">
                          <strong className="block text-sm font-bold">{item.value}</strong>
                          <span className="block text-xs text-muted-foreground">{item.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {[
                        { label: '后端存储', value: activeManifestSummary.backend },
                        { label: '检查点', value: activeManifestSummary.checkpointing },
                        { label: '技术细节', value: activeManifestSummary.debug },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{item.label}</span>
                          <strong className="font-medium">{item.value}</strong>
                        </div>
                      ))}
                    </div>
                    {activeManifestSummary.warnings.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {activeManifestSummary.warnings.map((item) => (
                          <Badge key={item} variant="warning">{item}</Badge>
                        ))}
                      </div>
                    )}
                    {activeManifestSummary.missing.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {activeManifestSummary.missing.map((item) => (
                          <Badge key={item} variant="destructive">{item}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">存量记录没有保存运行时清单。</p>
                )}
              </div>

              {/* Rerun relationship */}
              {(activeRun.rerun_of_run_id || activeDerivedRuns.length > 0) && (
                <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <h3 className="text-sm font-semibold">重跑关系</h3>
                  <div className="space-y-1.5">
                    {activeRun.rerun_of_run_id && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">当前来源</span>
                        <strong>
                          {sourceRun ? (
                            <Button size="sm" variant="link" className="h-auto p-0 text-xs"
                              onClick={() => setSelectedRun(sourceRun)}>
                              {shortRunId(sourceRun.id)}
                            </Button>
                          ) : (
                            shortRunId(activeRun.rerun_of_run_id)
                          )}
                        </strong>
                      </div>
                    )}
                    {activeDerivedRuns.length > 0 && (
                      <div className="flex items-start justify-between gap-2 text-xs">
                        <span className="text-muted-foreground shrink-0">本页派生</span>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {activeDerivedRuns.slice(0, 3).map((run) => (
                            <Button key={run.id} size="sm" variant="link" className="h-auto p-0 text-xs"
                              onClick={() => setSelectedRun(run)}>
                              {shortRunId(run.id)}
                            </Button>
                          ))}
                          {(activeRun.derived_run_count || 0) > activeDerivedRuns.length && (
                            <Badge variant="outline">共 {activeRun.derived_run_count}</Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Operations */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <h3 className="text-sm font-semibold">操作</h3>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => copyText(activeRun.input_text || activeRun.input_preview || '', '输入')}>复制输入</Button>
                  <Button size="sm" variant="outline" onClick={() => copyText(activeRun.output_text || activeRun.output_preview || '', '输出')}>复制输出</Button>
                  <Button size="sm" variant="outline" onClick={() => copyText(activeReplayPayload, '重放请求')}>复制重放请求</Button>
                  <Button size="sm" variant="outline" onClick={openStudio}>打开 Agent Studio</Button>
                </div>
              </div>

              {/* Runtime snapshot */}
              {runEvidence.data?.runtime_snapshot && Object.keys(runEvidence.data.runtime_snapshot).length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold hover:text-primary">查看运行快照</summary>
                    <pre className="mt-2 text-xs bg-muted/40 rounded p-2 overflow-x-auto">{activeRuntimeSnapshot}</pre>
                  </details>
                </div>
              )}

              {/* Runtime manifest */}
              {activeRun.runtime_manifest && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold hover:text-primary">查看运行清单</summary>
                    <pre className="mt-2 text-xs bg-muted/40 rounded p-2 overflow-x-auto">
                      {JSON.stringify(activeRun.runtime_manifest, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">等待选择运行记录。</p>
            </div>
          )}
        </aside>
      </div>
    </WorkspacePage>
  );
}
