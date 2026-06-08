import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Empty, Input, Popconfirm, Select, Space, Tabs, Tag, Tooltip } from 'antd';
import {
  CheckCircle2,
  Clipboard,
  FlaskConical,
  LayoutDashboard,
  RotateCcw,
  Scissors,
  XCircle,
} from 'lucide-react';
import { StatusTag, WorkspacePage } from '../components/ui';
import { api } from '../services/api';
import { canAtLeast } from '../services/authz';
import { productTerms, runtimeActorLabel, visibleRuntimeText } from '../services/productLanguage';
import type { AgentRun, RunIncidentItem, RunTraceEvent } from '../types/domain';
import {
  auditSourceColor,
  auditSourceLabel,
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
  incidentSeverityColor,
  isOrganizationRole,
  knowledgeAuditSummary,
  llmActorLabel,
  llmActorTagColor,
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
  const { message } = App.useApp();
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  const [status, setStatus] = useState<string>();
  const [agentId, setAgentId] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [tracePhase, setTracePhase] = useState<RunTraceEvent['phase']>();
  const [traceStatus, setTraceStatus] = useState<RunTraceEvent['status']>();
  const [traceResource, setTraceResource] = useState<string>();
  const [activeRunTab, setActiveRunTab] = useState<RunTabKey>('diagnosis');

  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 10000 });
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
    Array.from(new Set(activeEvents.flatMap((event) => [event.resource, event.subagent]).filter(Boolean) as string[]))
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
      message.success('已完成重跑');
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '重跑失败');
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
      message.success('运行已取消');
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '取消运行失败');
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
      message.success(rows.length ? `已标记 ${rows.length} 条超时运行` : '没有需要标记的超时运行');
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '超时标记失败');
    },
  });

  const createRegressionCase = useMutation({
    mutationFn: (run: AgentRun) => api.createTestCaseFromRun(run.id),
    onSuccess: (testCase) => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', testCase.agent_id] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      message.success(`已保存为验收用例：${testCase.name}`);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '保存验收用例失败');
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
      message.error(error instanceof Error ? error.message : '加载运行详情失败');
    }
  };

  const selectIncidentRun = (item: RunIncidentItem) => selectRunById(item.run_id);
  const copyText = (value: string, label: string) => {
    navigator.clipboard?.writeText(value || '').then(() => message.success(`${label}已复制`));
  };
  const openStudio = () => {
    window.history.pushState({}, '', '/agents');
    window.dispatchEvent(new Event('popstate'));
  };

  const renderRerunAction = (primary = false) => (
    <Button
      type={primary ? 'primary' : 'default'}
      icon={<RotateCcw size={14} />}
      loading={rerunMutation.isPending}
      disabled={!activeRun || !canRerunRun || rerunMutation.isPending}
      title={canRerunRun ? '使用相同输入和上线版本证据复验' : '需编辑权限'}
      onClick={() => activeRun && rerunMutation.mutate(activeRun.id)}
    >
      按原版本复验
    </Button>
  );

  const renderCreateCaseAction = (primary = false) => (
    <Button
      type={primary ? 'primary' : 'default'}
      icon={<FlaskConical size={14} />}
      loading={createRegressionCase.isPending}
      disabled={!activeRun || !canCreateRegressionCase || !activeRunHasInput}
      title={canCreateRegressionCase ? '从当前运行输入和输出摘要生成验收样本' : '需编辑权限'}
      onClick={() => activeRun && createRegressionCase.mutate(activeRun)}
    >
      沉淀验收样本
    </Button>
  );

  const renderCancelAction = (primary = false) => (
      <Popconfirm
      title="终止这次运行？"
      description="终止会把当前执行中的运行标记为已取消；流式请求会在下一次事件检查时停止。"
      disabled={!activeRun || !canCancelRun || activeRun.status !== 'running'}
      okText="终止运行"
      cancelText="保留运行"
      onConfirm={() => activeRun && cancelMutation.mutate(activeRun.id)}
    >
      <Button
        danger
        type={primary ? 'primary' : 'default'}
        icon={<XCircle size={14} />}
        loading={cancelMutation.isPending}
        disabled={!activeRun || !canCancelRun || activeRun.status !== 'running'}
        title={canCancelRun ? '终止运行' : '需编辑权限'}
      >
        终止运行
      </Button>
    </Popconfirm>
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

  const runTabs = activeRun ? [
    {
      key: 'diagnosis',
      label: '复盘',
      children: (
        <div className="run-tab-stack">
          <section className={`run-verdict-card ${failureDetail ? 'danger' : activeRun.status === 'running' ? 'warning' : 'ready'}`}>
            <div>
              {failureDetail ? <XCircle size={18} /> : activeRun.status === 'running' ? <LayoutDashboard size={18} /> : <CheckCircle2 size={18} />}
              <span>{statusDomainLabel(activeRun, failureDetail?.label)}</span>
            </div>
            <strong>{failureDetail?.message || activeRun.error || (activeRun.status === 'completed' ? '运行已完成，未发现异常事件。' : '等待更多运行事件。')}</strong>
            <p>
              {activeRun.status === 'running'
                ? '保持观察；如超过预期时长，可由编辑者终止现场。'
                : failureDetail
                  ? '先定位失败阶段；必要时按原版本复验，并把有效样本沉淀为验收资产。'
                  : `可复核业务输入、输出结果、${productTerms.action}记录和${productTerms.businessMaterial}依据。`}
            </p>
            <div className="run-next-action">
              <span>下一步</span>
              <strong>{runNextActionLabel(activeRun, failureDetail)}</strong>
            </div>
          </section>
          <section className="run-evidence-index" aria-label="证据索引">
            {evidenceIndexItems.map((item) => (
              <button
                type="button"
                className={item.tone === 'danger' ? 'danger' : item.tone === 'warning' ? 'warning' : ''}
                key={item.key}
                onClick={() => openRunEvidence(item.key as EvidenceIndexKey, item.tone)}
              >
                <span>{item.label}</span>
                <strong>{formatNumber(item.value)}</strong>
                <em>{item.hint}</em>
              </button>
            ))}
          </section>
          <section className="run-evidence-flow" aria-label="运行证据链">
            <div className="run-section-title">
              <strong>证据链</strong>
              <span>{activeEvents.length ? `${activeEvents.length} 个事件` : '暂无事件'}</span>
            </div>
            <div className="run-evidence-flow-track">
              {evidenceFlowItems.map((item) => {
                const content = (
                  <>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <em>{item.hint}</em>
                  </>
                );
                return item.onClick ? (
                  <button type="button" className={`run-evidence-node ${item.state}`} key={item.key} onClick={item.onClick}>
                    {content}
                  </button>
                ) : (
                  <div className={`run-evidence-node ${item.state}`} key={item.key}>
                    {content}
                  </div>
                );
              })}
            </div>
          </section>
          <div className="run-evidence-grid">
            {activeMetrics.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          {activeFailureItems.length > 0 && (
            <section className="run-section danger">
              <div className="run-section-title">
                <strong>失败链路</strong>
                <span>{activeFailureItems.length} 条异常证据</span>
              </div>
              <div className="run-failure-chain">
                {activeFailureItems.map((item, index) => (
                  <article key={item.key}>
                    <header>
                      <Tag color={index === 0 ? 'error' : 'warning'}>{index === 0 ? '首个异常' : '后续异常'}</Tag>
                      <strong>{item.phase} · {item.label}</strong>
                      {item.seq > 0 && <span>#{item.seq}</span>}
                    </header>
                    <p>{item.message}</p>
                    <footer>
                      {item.resource && <span>资源：{item.resource}</span>}
                      {item.callId && <span>调用：{shortCallId(item.callId)}</span>}
                      {item.timestamp && <span>{formatDate(item.timestamp)}</span>}
                    </footer>
                  </article>
                ))}
              </div>
            </section>
          )}
          {activeHandoffItems.length > 0 && (
            <section className="run-section">
              <div className="run-section-title">
                <strong>{productTerms.workRole}交接</strong>
                <span>{activeHandoffItems.length} 次</span>
              </div>
              <div className="run-handoff-list">
                {activeHandoffItems.map((item) => (
                  <article key={item.key} className={item.status === 'error' ? 'danger' : ''}>
                    <header>
                      <strong>{item.from} → {item.to}</strong>
                      <Space size={4} wrap>
                        <Tag color={item.status === 'error' ? 'error' : item.status === 'success' ? 'success' : 'default'}>
                          {traceStatusLabels[item.status] || item.status}
                        </Tag>
                        {item.durationMs > 0 && <Tag>{formatDuration(item.durationMs)}</Tag>}
                      </Space>
                    </header>
                    {item.task && <p>{item.task}</p>}
                    <div className="run-handoff-io">
                      <details>
                        <summary>交接输入</summary>
                        <pre>{item.input || item.task || '-'}</pre>
                      </details>
                      <details>
                        <summary>返回结果</summary>
                        <pre>{item.output || '-'}</pre>
                      </details>
                    </div>
                    <footer>
                      {item.seq > 0 && <span>事件 #{item.seq}</span>}
                      {item.parentSeq > 0 && <span>父事件 #{item.parentSeq}</span>}
                      {item.callId && <span>调用 {shortCallId(item.callId)}</span>}
                      {item.timestamp && <span>{formatDate(item.timestamp)}</span>}
                    </footer>
                  </article>
                ))}
              </div>
            </section>
          )}
          <section className="run-section">
            <div className="run-section-title">
              <strong>恢复验证</strong>
              <span>{runRecovery.isFetching ? '加载中' : runRecovery.data ? `${runRecovery.data.rerun_count || 0} 次重跑` : '无重跑记录'}</span>
            </div>
            {runRecovery.data ? (
              <div className="run-recovery-block">
                <div className="recovery-verdict">
                  <Tag color={recoveryStatusMeta[runRecovery.data.status].color}>
                    {recoveryStatusMeta[runRecovery.data.status].label}
                  </Tag>
                  <strong>{runRecovery.data.verdict || '等待复验结果'}</strong>
                  <span>{runRecovery.data.rerun_count ? `${runRecovery.data.rerun_count} 次重跑` : '暂无重跑'}</span>
                </div>
                <div className="recovery-compare-grid">
                  <button type="button" onClick={() => selectRunById(runRecovery.data.source_run.run_id)}>
                    <span>来源运行</span>
                    <strong>{shortRunId(runRecovery.data.source_run.run_id)}</strong>
                    <em>{recoverySnapshotLabel(runRecovery.data.source_run)}</em>
                  </button>
                  <button
                    type="button"
                    disabled={!runRecovery.data.latest_rerun}
                    onClick={() => runRecovery.data.latest_rerun && selectRunById(runRecovery.data.latest_rerun.run_id)}
                  >
                    <span>最近重跑</span>
                    <strong>{shortRunId(runRecovery.data.latest_rerun?.run_id)}</strong>
                    <em>{recoverySnapshotLabel(runRecovery.data.latest_rerun)}</em>
                  </button>
                </div>
                {runRecovery.data.latest_rerun && (
                  <div className="recovery-delta-grid">
                    {recoveryDeltaItems(runRecovery.data.deltas).map((item) => (
                      <div key={item.label}>
                        <strong>{item.value}</strong>
                        <span>{item.label}变化</span>
                      </div>
                    ))}
                  </div>
                )}
                {runRecovery.data.candidates.length > 0 && (
                  <div className="recovery-candidate-list">
                    {runRecovery.data.candidates.slice(0, 4).map((candidate) => (
                      <button key={candidate.run_id} type="button" onClick={() => selectRunById(candidate.run_id)}>
                        {runStatusTag(candidate.status)}
                        <strong>{shortRunId(candidate.run_id)}</strong>
                        <span>{candidate.output_preview || candidate.error_preview || formatDate(candidate.started_at)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mini-empty compact">暂无恢复验证数据。</div>
            )}
          </section>
        </div>
      ),
    },
    {
      key: 'trace',
      label: '执行过程',
      children: (
        <div className="run-tab-stack">
          <div className="trace-filter-row">
            <Select allowClear placeholder="阶段" value={tracePhase} onChange={setTracePhase} options={tracePhaseOptions} />
            <Select allowClear placeholder="状态" value={traceStatus} onChange={setTraceStatus} options={traceStatusOptions} />
            <Select
              allowClear
              showSearch
              placeholder={`资源/${productTerms.workRole}`}
              value={traceResource}
              onChange={setTraceResource}
              options={traceResourceOptions}
            />
            <Space wrap>
              <Button size="small" onClick={() => { setTracePhase(undefined); setTraceStatus('error'); setTraceResource(undefined); }}>
                只看错误
              </Button>
              <Button size="small" onClick={() => { setTracePhase('tool'); setTraceStatus(undefined); setTraceResource(undefined); }}>
                {productTerms.action}
              </Button>
              <Button size="small" onClick={() => { setTracePhase('subagent'); setTraceStatus(undefined); setTraceResource(undefined); }}>
                {productTerms.workRole}
              </Button>
              <Button size="small" disabled={!hasTraceFilter} onClick={() => { setTracePhase(undefined); setTraceStatus(undefined); setTraceResource(undefined); }}>
                全部
              </Button>
            </Space>
          </div>
          <section className="run-section">
            <div className="run-section-title">
              <strong>事件流</strong>
              <span>{activeEvents.length ? hasTraceFilter ? `${filteredEvents.length}/${activeEvents.length} 条` : `${activeEvents.length} 条` : '暂无事件'}</span>
            </div>
            {filteredEvents.length ? (
              <div className="run-event-stream">
                {filteredEvents.map((event, index) => (
                  <div className={`run-event-row ${eventTone(event)}`} key={`${event.seq || index}-${event.type}-${event.timestamp || ''}`}>
                    {renderEvent(event, index)}
                  </div>
                ))}
              </div>
            ) : activeEvents.length ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前过滤条件下没有运行记录" />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这次运行没有记录运行过程" />
            )}
          </section>
        </div>
      ),
    },
    {
      key: 'io',
      label: '业务输入与输出',
      children: (
        <div className="run-tab-stack">
          <div className="io-grid">
            <section className="run-section">
              <div className="run-section-title">
                <strong>业务输入</strong>
                <Button size="small" icon={<Clipboard size={13} />} onClick={() => copyText(activeRun.input_text || activeRun.input_preview || '', '输入')}>
                  复制
                </Button>
              </div>
              <pre>{activeRun.input_text || activeRun.input_preview || '-'}</pre>
            </section>
            <section className="run-section">
              <div className="run-section-title">
               <strong>交付输出</strong>
                <Button size="small" icon={<Clipboard size={13} />} onClick={() => copyText(activeRun.output_text || activeRun.output_preview || '', '输出')}>
                  复制
                </Button>
              </div>
              <pre>{activeRun.output_text || activeRun.output_preview || '-'}</pre>
            </section>
          </div>
          <section className="run-section replay">
            <div className="run-section-title">
              <strong>Responses 重放请求</strong>
              <Button size="small" icon={<Clipboard size={13} />} onClick={() => copyText(activeReplayPayload, '重放请求')}>
                复制
              </Button>
            </div>
            <p className="run-section-note">用于复现同一次业务输入；正式复验以后端保存的上线版本快照为准。</p>
            <pre>{activeReplayPayload}</pre>
          </section>
          {activeFailureItems.length > 0 && (
            <section className="run-section danger">
              <div className="run-section-title">
                <strong>异常摘要</strong>
                <span>{activeFailureItems.length} 条</span>
              </div>
              <div className="run-failure-chain compact">
                {activeFailureItems.map((item) => (
                  <article key={item.key}>
                    <header>
                      <strong>{item.phase} · {item.label}</strong>
                      {item.seq > 0 && <span>#{item.seq}</span>}
                    </header>
                    <p>{item.message}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      ),
    },
    {
      key: 'audit',
      label: '证据明细',
      children: (
        <div className="run-tab-stack">
          <section className="run-section">
            <div className="run-section-title">
              <strong>模型调用</strong>
              <span>{runEvidence.isFetching ? '加载中' : `${activeLlmLogs.length} 条`}</span>
            </div>
            {activeLlmLogs.length > 0 ? (
              <>
                <div className="runtime-chip-grid">
                  <div><strong>{activeLlmLogSummary.calls}</strong><span>调用</span></div>
                  <div><strong>{formatNumber(activeLlmLogSummary.tokens)}</strong><span>Token</span></div>
                  <div><strong>{activeLlmLogSummary.firstToken ? `${activeLlmLogSummary.firstToken}ms` : '-'}</strong><span>首响应</span></div>
                  <div><strong>{activeLlmLogSummary.failures}</strong><span>失败记录</span></div>
                </div>
                {activeLlmLogSummary.actors.size > 0 && (
                  <div className="runtime-chip-grid trace-contract-grid llm-actor-grid">
                    {Array.from(activeLlmLogSummary.actors.values()).slice(0, 4).map((item) => (
                      <div key={`${item.actor}-${item.model}`}>
                        <strong>{formatNumber(item.tokens)}</strong>
                        <span>
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
                <div className="llm-log-list">
                  {activeLlmLogs.slice(0, 6).map((record) => (
                    <div className="llm-log-item" key={record.id}>
                      <div className="llm-log-meta">
                        <Tag color={record.status === 'failed' || record.error ? 'error' : 'success'}>
                          {record.status === 'failed' || record.error ? '失败' : '成功'}
                        </Tag>
                        <Tag color={llmActorTagColor(record)}>{llmActorLabel(record)}</Tag>
                        <Tag>{formatNumber(record.llm_calls || 0)} 次</Tag>
                        <span>{record.provider_type}</span>
                        <span>{record.model}</span>
                        <span>{formatDate(record.created_at)}</span>
                      </div>
                      <p>
                        {formatNumber(record.input_tokens)} / {formatNumber(record.output_tokens)} / {formatNumber(record.total_tokens)} Token
                        {record.duration_ms ? ` · ${record.duration_ms} ms` : ''}
                      </p>
                      {record.error && <em>{record.error}</em>}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="mini-empty compact">当前运行没有模型调用记录。</div>
            )}
          </section>
          <section className="run-section">
            <div className="run-section-title">
              <strong>{productTerms.action}调用</strong>
              <span>{runEvidence.isFetching ? '加载中' : `${activeToolAudits.length} 条`}</span>
            </div>
            {activeToolAudits.length > 0 ? (
              <div className="tool-audit-list">
                {activeToolAudits.map((record) => (
                  <article className="tool-audit-item" key={record.id}>
                    <header>
                      <div>
                        <strong>{record.tool_id}</strong>
                        <span>
                          {record.implementation}
                          {record.method ? ` · ${record.method}` : ''}
                          {record.call_id ? ` · 调用 ${shortCallId(record.call_id)}` : ' · 无调用 ID'}
                        </span>
                      </div>
                      <Space size={4} wrap>
                        <StatusTag status={record.status} />
                        <Tag color={auditSourceColor(record.source)}>{auditSourceLabel(record.source)}</Tag>
                      </Space>
                    </header>
                    <div className="tool-audit-endpoint">
                      <span>{record.method || 'METHOD'}</span>
                      <code>{record.url || record.tool_id}</code>
                    </div>
                    {record.error && <p className="tool-audit-error">{record.error}</p>}
                    <div className="tool-audit-io">
                      <details>
                        <summary>请求</summary>
                        <pre>{record.request_preview || '-'}</pre>
                      </details>
                      <details>
                        <summary>响应</summary>
                        <pre>{record.response_preview || record.error || '-'}</pre>
                      </details>
                    </div>
                    <footer>
                      <span>{record.duration_ms || 0}ms</span>
                      <span>{formatDate(record.created_at)}</span>
                      <span>{shortAuditUser(record.user_id)}</span>
                      {record.actor_role && (
                        <Tag color={isOrganizationRole(record.actor_role) ? 'blue' : 'default'}>
                          {isOrganizationRole(record.actor_role) ? roleLabels[record.actor_role] : record.actor_role}
                        </Tag>
                      )}
                      {(record.run_id || record.agent_id || record.conversation_id) && (
                        <Tooltip
                          title={
                            <div className="audit-context-tooltip">
                              {record.run_id && <div>运行: {record.run_id}</div>}
                              {record.agent_id && <div>服务: {record.agent_id}</div>}
                              {record.conversation_id && <div>执行上下文: {record.conversation_id}</div>}
                            </div>
                          }
                        >
                          <span className="resource-chip">上下文</span>
                        </Tooltip>
                      )}
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`这次运行没有${productTerms.action}运行证据`} />
            )}
          </section>
          <section className="run-section">
            <div className="run-section-title">
              <strong>{productTerms.businessMaterial}召回</strong>
              <span>{runEvidence.isFetching ? '加载中' : `${activeKnowledgeAudits.length} 条`}</span>
            </div>
            {activeKnowledgeAudits.length > 0 ? (
              <>
                <div className="runtime-chip-grid">
                  <div><strong>{activeKnowledgeAudits.length}</strong><span>检索</span></div>
                  <div><strong>{activeKnowledgeAuditSummary.retrieved}</strong><span>召回片段</span></div>
                  <div><strong>{activeKnowledgeAuditSummary.indexed}</strong><span>索引片段</span></div>
                  <div><strong>{Array.from(activeKnowledgeAuditSummary.sources).join('/') || '-'}</strong><span>索引来源</span></div>
                </div>
                <div className="knowledge-audit-list">
                  {activeKnowledgeAudits.slice(0, 3).map((record) => (
                    <div className="knowledge-audit-item" key={record.id}>
                      <div className="knowledge-audit-meta">
                        <Tag color="blue">{record.index_source || 'unknown'}</Tag>
                        <span>{record.retrieved_chunks}/{record.indexed_chunks} 片段</span>
                        <span>{formatDate(record.created_at)}</span>
                      </div>
                      <p>{record.query_preview || '-'}</p>
                      <div className="knowledge-audit-refs">
                        {record.chunk_refs.slice(0, 3).map((chunk) => (
                          <Tooltip key={chunk.chunk_id || `${chunk.document_id}-${chunk.ordinal}`} title={chunk.preview || chunk.content_hash}>
                            <Tag>{chunk.file_name}#{chunk.ordinal + 1}</Tag>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="mini-empty compact">当前运行没有业务资料召回证据。</div>
            )}
          </section>
        </div>
      ),
    },
  ] : [];

  return (
      <WorkspacePage
      className="run-center-page"
      icon={<LayoutDashboard size={14} />}
      eyebrow="运行证据"
      title="运行证据"
      description={`面向上线 ${productTerms.agentService} 的执行复盘、证据链、外部${productTerms.action}、模型调用和复验闭环。`}
    >
      <section className="run-ops-strip" aria-label="运行总览">
          <div className="run-ops-copy">
            <span className={`run-command-badge ${runCommandTone}`}>{runCommandLabel}</span>
          <h2>{openIncidents ? `${formatNumber(openIncidents)} 个运行事件待处置` : activeRun ? `${activeRun.agent_name || activeRun.agent_id} 的当前现场` : '暂无运行证据'}</h2>
          <p>
            {openIncidents
              ? `近 24 小时：${formatNumber(blockedIncidents)} 阻断 / ${formatNumber(stats.data?.failed_runs || 0)} 失败 / ${formatNumber(stats.data?.stale_runs || 0)} 超时 / ${formatNumber(stats.data?.cancelled_runs || 0)} 取消`
              : activeRun
                ? `${runStatusMeta[activeRun.status]?.label || activeRun.status} · ${formatDate(activeRun.started_at)} · ${activeRun.duration_ms ? formatDuration(activeRun.duration_ms) : '未记录耗时'}`
                : '等待运行记录'}
          </p>
        </div>
        <div className="run-ops-stats">
          <div className={openIncidents ? 'danger' : 'ready'}>
            <span>待处置</span>
            <strong>{formatNumber(openIncidents)}</strong>
            <em>运行事件</em>
          </div>
          <div className={(stats.data?.running_runs || 0) ? 'warning' : 'ready'}>
            <span>运行中</span>
            <strong>{formatNumber(stats.data?.running_runs || 0)}</strong>
            <em>现场执行</em>
          </div>
          <div>
            <span>失败</span>
            <strong>{formatNumber(stats.data?.failed_runs || 0)}</strong>
            <em>需复验</em>
          </div>
          <div>
            <span>超时</span>
            <strong>{formatNumber(stats.data?.stale_runs || 0)}</strong>
            <em>待确认</em>
          </div>
        </div>
      </section>

      <section className="run-workbench-v2">
        <aside className="run-ledger-panel" aria-label="事件队列">
          <div className="run-panel-heading">
            <div>
              <strong>事件队列</strong>
              <span>按异常优先级处理生产现场。</span>
            </div>
            <Button
              icon={<Scissors size={14} />}
              disabled={!canMarkStaleRuns}
              loading={markStaleMutation.isPending}
              title={canMarkStaleRuns ? '标记超过 120 分钟未结束的运行' : '需管理员权限'}
              onClick={() => markStaleMutation.mutate()}
            >
              标记超时
            </Button>
          </div>

          <div className="run-incident-metrics">
            {(incidents.data?.queues || []).map((queue) => (
              <button
                type="button"
                key={queue.key}
                className={`run-incident-metric ${status === incidentQueueStatus(queue.key) ? 'active' : ''}`}
                onClick={() => setStatus(incidentQueueStatus(queue.key))}
              >
                <strong>{formatNumber(queue.count)}</strong>
                <span>{queue.label}</span>
              </button>
            ))}
          </div>

          <div className="run-incident-list">
            {(incidents.data?.queues || []).map((queue) => (
              queue.items.length > 0 && (
                <section className="run-incident-group" key={queue.key}>
                  <div className="run-incident-group-head">
                    <strong>{queue.label}</strong>
                    <span>{formatNumber(queue.count)} 条</span>
                  </div>
                  {queue.items.map((item) => (
                    <button
                      type="button"
                      key={item.run_id}
                      className="run-incident-item"
                      onClick={() => selectIncidentRun(item)}
                    >
                      <Tag color={incidentSeverityColor(item.severity)}>
                        {runStatusMeta[item.status]?.label || item.status}
                      </Tag>
                      <strong>{item.agent_name || item.agent_id}</strong>
                      <span>{item.reason}</span>
                      <em>{item.evidence || item.error_preview || item.input_preview || formatDate(item.started_at)}</em>
                    </button>
                  ))}
                </section>
              )
            ))}
            {!incidents.isLoading && !incidentItems.length && (
              <div className="mini-empty compact">近 24 小时没有待处置事件。</div>
            )}
          </div>

          <div className="run-queue-controls">
            <Input.Search allowClear placeholder={`搜索 ${productTerms.agentService}、异常摘要或业务输入`} onSearch={setKeyword} />
            <Select
              allowClear
              placeholder="Agent"
              value={agentId}
              onChange={setAgentId}
              options={(agents.data || []).map((agent) => ({ value: agent.id, label: agent.name }))}
            />
            <Select
              allowClear
              placeholder="状态"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'completed', label: '成功' },
                { value: 'blocked', label: '已阻断' },
                { value: 'failed', label: '失败' },
                { value: 'running', label: '运行中' },
                { value: 'cancelled', label: '已取消' },
                { value: 'stale', label: '超时未结束' },
              ]}
            />
          </div>

          <div className="run-queue-list">
            {(runs.data || []).map((run) => (
              <button
                type="button"
                key={run.id}
                className={activeRun?.id === run.id ? 'run-queue-item active' : 'run-queue-item'}
                onClick={() => setSelectedRun(run)}
              >
                <div>
                  {runStatusTag(run.status)}
                  {runSourceTag(run)}
                  {run.rerun_of_run_id && <Tag color="purple">重跑</Tag>}
                  {(run.derived_run_count || 0) > 0 && <Tag color="cyan">已复验</Tag>}
                </div>
                <strong>{run.agent_name || run.agent_id}</strong>
                <span>{run.input_preview || run.input_text || '无输入摘要'}</span>
                <footer>
                  <em>{formatDuration(run.duration_ms) || (run.status === 'running' ? '运行中' : '即时')}</em>
                  <em>{formatDate(run.started_at)}</em>
                </footer>
              </button>
            ))}
            {!runs.isLoading && !(runs.data || []).length && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行记录" />
            )}
          </div>
        </aside>

        <section className="run-case-panel" aria-label="运行详情">
          {activeRun ? (
            <>
              <header className="run-case-header">
                <div>
                  <span>当前运行现场</span>
                  <h2>{activeRun.agent_name || activeRun.agent_id}</h2>
                  <p>{activeRun.input_preview || activeRun.input_text || '无输入摘要'}</p>
                </div>
                <Space wrap>
                  {runStatusTag(activeRun.status)}
                  {entrypointTag(activeRun)}
                  {releaseTag(activeRun)}
                  {runSourceTag(activeRun)}
                  {activeRun.rerun_of_run_id && <Tag color="purple">复验</Tag>}
                  {(activeRun.derived_run_count || 0) > 0 && <Tag color="cyan">已复验 {activeRun.derived_run_count}</Tag>}
                </Space>
              </header>
              <div className="run-protocol-strip" aria-label="运行证据路径">
                <div>
                  <span>执行协议</span>
                  <strong>{activeEntrypointMeta?.name || entrypointMeta[activeRun.entrypoint || '']?.label || '存量入口'}</strong>
                  <em>{activeEntrypointMeta ? `${activeEntrypointMeta.role} · ${activeEntrypointMeta.path}` : '写入统一运行证据'}</em>
                </div>
                <div>
                  <span>触发入口</span>
                  <strong>{activeTriggerMeta?.name || runSourceMeta[activeRun.run_source || '']?.label || activeRun.run_source || '运行'}</strong>
                  <em>{activeTriggerMeta ? `${activeTriggerMeta.role} · ${activeTriggerMeta.path}` : '触发来源待确认'}</em>
                </div>
                <div>
                  <span>配置来源</span>
                  <strong>{runtimeSourceMeta[activeRun.runtime_source || '']?.label || activeRun.runtime_source || '存量记录'}</strong>
                  <em>{activeRun.release_id ? `上线版本 v${activeRun.agent_version || 1}` : '未绑定上线版本'}</em>
                </div>
                <div>
                  <span>版本证据</span>
                  <strong>{shortHash(activeRun.manifest_hash || activeRun.spec_hash)}</strong>
                  <em>{activeManifestSummary ? `Manifest · ${activeManifestSummary.mainTools} 工具 / ${activeManifestSummary.subagents} 协作角色` : '存量记录未保存清单'}</em>
                </div>
                <div>
                  <span>复验关系</span>
                  <strong>{activeRun.rerun_of_run_id ? '复验运行' : (activeRun.derived_run_count || 0) > 0 ? '已有复验' : '原始运行'}</strong>
                  <em>{activeRun.rerun_of_run_id ? shortRunId(activeRun.rerun_of_run_id) : `${activeRun.derived_run_count || 0} 条派生运行`}</em>
                </div>
              </div>
              <div className="run-case-actions">
                <div className="run-primary-action">
                  {activePrimaryAction === 'cancel' && renderCancelAction(true)}
                  {activePrimaryAction === 'case' && renderCreateCaseAction(true)}
                  {activePrimaryAction === 'rerun' && renderRerunAction(true)}
                  <span>
                    {activePrimaryAction === 'cancel'
                      ? '运行仍在进行，先控制现场。'
                      : activePrimaryAction === 'case'
                        ? '结果可复用时，沉淀为验收样本。'
                        : '使用原上线版本验证异常是否可恢复。'}
                  </span>
                </div>
                <Space wrap className="run-secondary-actions">
                  {activePrimaryAction !== 'rerun' && renderRerunAction(false)}
                  {activePrimaryAction !== 'case' && renderCreateCaseAction(false)}
                  {activePrimaryAction !== 'cancel' && renderCancelAction(false)}
                </Space>
              </div>
              <Tabs className="run-case-tabs" activeKey={activeRunTab} onChange={(key) => setActiveRunTab(key as RunTabKey)} items={runTabs} />
            </>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一条运行记录查看详情" />
          )}
        </section>

        <aside className="run-file-panel" aria-label="复核信息">
          {activeRun ? (
            <>
              <section>
                <h3>运行档案</h3>
                <div className="kv-list">
                  <div><span>状态</span><strong>{runStatusMeta[activeRun.status]?.label || activeRun.status}</strong></div>
                  <div><span>{productTerms.agentService}</span><strong>{activeRun.agent_name || activeRun.agent_id}</strong></div>
                  <div><span>运行来源</span><strong>{runtimeSourceMeta[activeRun.runtime_source || '']?.label || activeRun.runtime_source || '存量记录'}</strong></div>
                  <div><span>触发来源</span><strong>{runSourceMeta[activeRun.run_source || '']?.label || activeRun.run_source || '运行'}</strong></div>
                  <div><span>上线版本</span><strong>{activeRun.release_id ? `v${activeRun.agent_version || 1}` : '-'}</strong></div>
                  <div><span>来源运行</span><strong>{activeRun.rerun_of_run_id ? shortRunId(activeRun.rerun_of_run_id) : '-'}</strong></div>
                  <div><span>派生运行</span><strong>{activeRun.derived_run_count || 0}</strong></div>
                  <div><span>发起时间</span><strong>{formatDate(activeRun.started_at)}</strong></div>
                  <div><span>结束时间</span><strong>{formatDate(activeRun.ended_at)}</strong></div>
                  <div><span>耗时</span><strong>{activeRun.status === 'running' ? '运行中' : formatDuration(activeRun.duration_ms)}</strong></div>
                  <div><span>失败原因</span><strong>{failureDetail?.label || activeRun.error || '-'}</strong></div>
                </div>
              </section>
              <section>
                <details className="run-technical-details">
                  <summary>协议与模型</summary>
                  <div className="kv-list">
                    <div><span>执行协议</span><strong>{activeEntrypointMeta?.path || activeRun.entrypoint || '-'}</strong></div>
                    <div><span>触发入口</span><strong>{activeTriggerMeta?.path || activeRun.run_source || '-'}</strong></div>
                    <div><span>模型</span><strong>{activeRun.model}</strong></div>
                    <div><span>上线版本 ID</span><strong>{activeRun.release_id || '-'}</strong></div>
                    <div><span>Manifest Hash</span><strong>{shortHash(activeRun.manifest_hash)}</strong></div>
                    <div><span>配置 Hash</span><strong>{shortHash(activeRun.spec_hash)}</strong></div>
                  </div>
                  {activeEntrypointMeta && (
                    <div className="run-protocol-card">
                      <h3>执行协议</h3>
                      <div className="run-protocol-line">
                        <strong>{activeEntrypointMeta.name}</strong>
                        <code>{activeEntrypointMeta.path}</code>
                      </div>
                      <div className="run-protocol-assurance">
                        <span>{activeEntrypointMeta.role}</span>
                        <span>{activeEntrypointMeta.evidence}</span>
                      </div>
                      <p>{activeEntrypointMeta.note}</p>
                    </div>
                  )}
                  {activeTriggerMeta && (
                    <div className="run-protocol-card">
                      <h3>触发入口</h3>
                      <div className="run-protocol-line">
                        <strong>{activeTriggerMeta.name}</strong>
                        <code>{activeTriggerMeta.path}</code>
                      </div>
                      <div className="run-protocol-assurance">
                        <span>{activeTriggerMeta.role}</span>
                        <span>{activeTriggerMeta.evidence}</span>
                      </div>
                      <p>{activeTriggerMeta.note}</p>
                    </div>
                  )}
                </details>
              </section>
              {activeLlmContracts.length > 0 && (
                <section>
                  <h3>模型响应路径</h3>
                  <div className="runtime-chip-grid trace-contract-grid">
                    {activeLlmContracts.map((item, contractIndex) => (
                      <div key={`${String(item.scope || 'scope')}-${String(item.subagent || contractIndex)}-${String(item.model || contractIndex)}`}>
                        <strong>{String(item.model || '-')}</strong>
                        <span>
                          {runtimeActorLabel(String(item.scope || 'main'), item.subagent ? String(item.subagent) : undefined)}
                          {' · '}
                          {String(item.provider_type || '-')}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <section>
                <h3>证据摘要</h3>
                <div className="runtime-chip-grid">
                  <div><strong>{activeToolAuditSummary.total}</strong><span>{productTerms.action}调用</span></div>
                  <div><strong>{activeToolAuditSummary.failed}</strong><span>{productTerms.action}失败</span></div>
                  <div><strong>{activeLlmLogSummary.calls}</strong><span>模型调用</span></div>
                  <div><strong>{activeLlmLogSummary.failures}</strong><span>模型失败</span></div>
                </div>
              </section>
              <section>
                <h3>{productTerms.businessMaterial}召回</h3>
                <div className="runtime-chip-grid">
                  <div><strong>{activeKnowledgeAudits.length}</strong><span>检索</span></div>
                  <div><strong>{activeKnowledgeAuditSummary.retrieved}</strong><span>召回片段</span></div>
                  <div><strong>{activeKnowledgeAuditSummary.indexed}</strong><span>索引片段</span></div>
                  <div><strong>{Array.from(activeKnowledgeAuditSummary.sources).join('/') || '-'}</strong><span>索引来源</span></div>
                </div>
              </section>
              <section>
                <h3>上线版本证据</h3>
                {activeManifestSummary ? (
                  <>
                    <div className="runtime-chip-grid">
                      <div><strong>{activeManifestSummary.mainTools}</strong><span>{productTerms.action}</span></div>
                      <div><strong>{activeManifestSummary.mainSkills}</strong><span>{productTerms.capabilityPackage}</span></div>
                      <div><strong>{activeManifestSummary.subagents}</strong><span>{productTerms.workRole}</span></div>
                      <div><strong>{activeRun.knowledge_count}</strong><span>{productTerms.businessMaterial}</span></div>
                    </div>
                    <div className="impact-list">
                      <div><span>后端存储</span><strong>{activeManifestSummary.backend}</strong></div>
                      <div><span>检查点</span><strong>{activeManifestSummary.checkpointing}</strong></div>
                      <div><span>技术细节</span><strong>{activeManifestSummary.debug}</strong></div>
                    </div>
                    {activeManifestSummary.warnings.length > 0 && (
                      <Space wrap>
                        {activeManifestSummary.warnings.map((item) => <Tag color="warning" key={item}>{item}</Tag>)}
                      </Space>
                    )}
                    {activeManifestSummary.missing.length > 0 && (
                      <Space wrap>
                        {activeManifestSummary.missing.map((item) => <Tag color="error" key={item}>{item}</Tag>)}
                      </Space>
                    )}
                  </>
                ) : (
                  <div className="mini-empty compact">存量记录没有保存运行时清单。</div>
                )}
              </section>
              {(activeRun.rerun_of_run_id || activeDerivedRuns.length > 0) && (
                <section>
                  <h3>重跑关系</h3>
                  <div className="kv-list recovery-local-links">
                    {activeRun.rerun_of_run_id && (
                      <div>
                        <span>当前来源</span>
                        <strong>
                          {sourceRun ? (
                            <Button size="small" type="link" onClick={() => setSelectedRun(sourceRun)}>
                              {shortRunId(sourceRun.id)}
                            </Button>
                          ) : (
                            shortRunId(activeRun.rerun_of_run_id)
                          )}
                        </strong>
                      </div>
                    )}
                    {activeDerivedRuns.length > 0 && (
                      <div>
                        <span>本页派生</span>
                        <strong>
                          <Space size={4} wrap>
                            {activeDerivedRuns.slice(0, 3).map((run) => (
                              <Button key={run.id} size="small" type="link" onClick={() => setSelectedRun(run)}>
                                {shortRunId(run.id)}
                              </Button>
                            ))}
                            {(activeRun.derived_run_count || 0) > activeDerivedRuns.length && (
                              <Tag>共 {activeRun.derived_run_count}</Tag>
                            )}
                          </Space>
                        </strong>
                      </div>
                    )}
                  </div>
                </section>
              )}
              <section>
                <h3>操作</h3>
                <Space wrap>
                  <Button onClick={() => copyText(activeRun.input_text || activeRun.input_preview || '', '输入')}>复制输入</Button>
                  <Button onClick={() => copyText(activeRun.output_text || activeRun.output_preview || '', '输出')}>复制输出</Button>
                  <Button onClick={() => copyText(activeReplayPayload, '重放请求')}>复制重放请求</Button>
                  <Button onClick={openStudio}>打开 Agent Studio</Button>
                </Space>
              </section>
              {runEvidence.data?.runtime_snapshot && Object.keys(runEvidence.data.runtime_snapshot).length > 0 && (
                <section>
                  <details className="run-manifest-details">
                    <summary>查看运行快照</summary>
                    <pre>{activeRuntimeSnapshot}</pre>
                  </details>
                </section>
              )}
              {activeRun.runtime_manifest && (
                <section>
                  <details className="run-manifest-details">
                    <summary>查看运行清单</summary>
                    <pre>{JSON.stringify(activeRun.runtime_manifest, null, 2)}</pre>
                  </details>
                </section>
              )}
            </>
          ) : (
            <div className="mini-empty compact">等待选择运行记录。</div>
          )}
        </aside>
      </section>
    </WorkspacePage>
  );
}
