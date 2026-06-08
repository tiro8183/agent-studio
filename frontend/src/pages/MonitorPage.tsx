import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, InputNumber, Popconfirm, Progress, Space, Switch, Tag } from 'antd';
import { Activity, AlertTriangle, CheckCircle2, Database, HardDrive, RefreshCw, RotateCcw, Scissors, ShieldCheck } from 'lucide-react';
import { PageSurface, StatusSummary, WorkspacePage } from '../components/ui';
import { api } from '../services/api';
import { productTerms, runtimeActorLabel, visibleRuntimeText } from '../services/productLanguage';
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

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let next = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && next >= 1024; index += 1) {
    next /= 1024;
    unit = units[index];
  }
  return `${next >= 10 ? next.toFixed(1) : next.toFixed(2)} ${unit}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value || 0);
}

function runStatusTag(status: string) {
  const color = status === 'completed' ? 'success' : status === 'failed' ? 'error' : status === 'running' ? 'processing' : 'default';
  const label = status === 'completed' ? '成功' : status === 'failed' ? '失败' : status === 'running' ? '运行中' : status || '-';
  return <Tag color={color}>{label}</Tag>;
}

function runtimeScopeLabel(item: LLMUsageBreakdownItem | LLMHealthBreakdownItem) {
  return runtimeActorLabel(item.runtime_scope, item.subagent_name);
}

export default function MonitorPage() {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [retentionForm, setRetentionForm] = useState<RunRetentionRequest>({});

  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 10000 });
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
      message.success(`已完成预览：${result.eligible_runs} 条运行可清理`);
    },
  });
  const applyRetention = useMutation({
    mutationFn: () => api.applyRunRetention(effectiveRetentionForm),
    onSuccess: (result) => {
      queryClient.setQueryData(['run-retention'], result);
      refreshOps();
      message.success(`已清理 ${result.deleted_runs} 条运行证据`);
    },
  });

  return (
    <WorkspacePage
      className="monitor-page"
      icon={<Activity size={14} />}
      eyebrow="平台观测"
      title="平台观测"
      description="查看模型可用性、运行异常、容量和清理策略。"
      actions={
        canViewReadiness && readiness.data && (
          <Tag color={readiness.data.status === 'ready' ? 'success' : readiness.data.status === 'degraded' ? 'warning' : 'error'}>
            {readiness.data.environment}
          </Tag>
        )
      }
    >
      <StatusSummary
        ariaLabel="平台运行保障台"
        badge={readinessLabel}
        badgeTone={readinessTone}
        title={commandTitle}
        description="运行异常、模型可用性、上传配额和状态存储。"
        actions={(
          <>
            <Button icon={<RefreshCw size={15} />} onClick={refreshOps}>
              刷新状态
            </Button>
            <Button
              icon={<RotateCcw size={15} />}
              loading={previewRetention.isPending || runRetention.isFetching}
              onClick={() => previewRetention.mutate()}
            >
              预览清理
            </Button>
          </>
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
      <section className="ops-workbench">
        <PageSurface
          className="llm-usage-surface"
          title="模型调用分布"
          description={`按主流程、${productTerms.workRole}、模型和通道来源聚合调用量与 Token，帮助判断通道质量和资源消耗。`}
          actions={
            llmUsageBreakdown.data && (
              <Tag color="processing">
                {formatNumber(llmUsageBreakdown.data.total_llm_calls)} 次调用
              </Tag>
            )
          }
        >
          <div className="llm-usage-layout">
            <div className="retention-metrics">
              <div><strong>{formatNumber(llmUsageBreakdown.data?.total_llm_calls || 0)}</strong><span>总调用</span></div>
              <div><strong>{formatNumber(llmUsageBreakdown.data?.total_tokens || 0)}</strong><span>总 Token</span></div>
              <div><strong>{formatNumber(llmUsageBreakdown.data?.input_tokens || 0)}</strong><span>输入 Token</span></div>
              <div><strong>{formatNumber(llmUsageBreakdown.data?.output_tokens || 0)}</strong><span>输出 Token</span></div>
            </div>
            <div className="llm-usage-table">
              {(llmUsageBreakdown.data?.items || []).slice(0, 8).map((item) => (
                <div key={`${item.runtime_scope}-${item.subagent_name}-${item.provider_type}-${item.model}-${item.llm_config_id}`}>
                  <div>
                    <strong>{runtimeScopeLabel(item)}</strong>
                    <span>{item.provider_type || '-'} · {item.model || '-'}</span>
                  </div>
                  <div><strong>{formatNumber(item.total_tokens)}</strong><span>Token</span></div>
                  <div><strong>{formatNumber(item.llm_calls)}</strong><span>调用</span></div>
                  <div><strong>{formatNumber(item.input_tokens)}</strong><span>输入</span></div>
                  <div><strong>{formatNumber(item.output_tokens)}</strong><span>输出</span></div>
                </div>
              ))}
              {!llmUsageBreakdown.isLoading && !(llmUsageBreakdown.data?.items || []).length && (
                <div className="mini-empty compact">还没有模型调用数据。</div>
              )}
            </div>
          </div>
        </PageSurface>
        <PageSurface
          className="llm-health-surface"
          title="模型健康"
          description={`按主流程、${productTerms.workRole}、通道来源和模型聚合成功率、失败调用、平均耗时和首响应延迟。`}
          actions={
            llmHealthBreakdown.data && (
              <Tag color={llmHealthBreakdown.data.failed_llm_calls > 0 ? 'error' : 'success'}>
                {llmHealthBreakdown.data.success_rate}% 成功率
              </Tag>
            )
          }
        >
          <div className="llm-usage-layout">
            <div className="retention-metrics">
              <div><strong>{formatNumber(llmHealthBreakdown.data?.total_llm_calls || 0)}</strong><span>总调用</span></div>
              <div><strong>{llmHealthBreakdown.data?.success_rate || 0}%</strong><span>成功率</span></div>
              <div><strong>{formatNumber(llmHealthBreakdown.data?.failed_llm_calls || 0)}</strong><span>失败调用</span></div>
              <div><strong>{formatNumber(llmHealthBreakdown.data?.avg_first_token_ms || 0)}ms</strong><span>首响应延迟</span></div>
            </div>
            <div className="llm-health-table">
              {(llmHealthBreakdown.data?.items || []).slice(0, 8).map((item) => (
                <div key={`${item.runtime_scope}-${item.subagent_name}-${item.provider_type}-${item.model}-${item.llm_config_id}`}>
                  <div>
                    <strong>{runtimeScopeLabel(item)}</strong>
                    <span>{item.provider_type || '-'} · {item.model || '-'}</span>
                  </div>
                  <div><strong>{item.success_rate}%</strong><span>成功率</span></div>
                  <div><strong>{formatNumber(item.failed_llm_calls)}</strong><span>失败</span></div>
                  <div><strong>{formatNumber(item.avg_duration_ms)}ms</strong><span>平均耗时</span></div>
                  <div><strong>{formatNumber(item.avg_first_token_ms)}ms</strong><span>首响应</span></div>
                  <div className="llm-health-error">
                    {item.last_error ? <Tag color="error">{item.last_error}</Tag> : <Tag color="success">无失败样本</Tag>}
                  </div>
                </div>
              ))}
              {!llmHealthBreakdown.isLoading && !(llmHealthBreakdown.data?.items || []).length && (
                <div className="mini-empty compact">还没有模型健康数据。</div>
              )}
            </div>
          </div>
        </PageSurface>
        <PageSurface
          className="retention-surface"
          title="运行保留策略"
          description="按租户清理过期运行证据，保留最新运行和测试结果。"
          actions={
            <Space wrap>
              <Button
                icon={<RotateCcw size={14} />}
                loading={previewRetention.isPending || runRetention.isFetching}
                onClick={() => previewRetention.mutate()}
              >
                预览清理
              </Button>
              <Popconfirm
                title="执行运行证据清理？"
                description={`将清理 ${activeRetention?.eligible_runs || 0} 条符合策略的运行证据。`}
                okText="执行清理"
                cancelText="取消"
                disabled={!canApplyRetention || !activeRetention?.eligible_runs}
                onConfirm={() => applyRetention.mutate()}
              >
                <Button
                  danger
                  type="primary"
                  icon={<Scissors size={14} />}
                  loading={applyRetention.isPending}
                  disabled={!canApplyRetention || !activeRetention?.eligible_runs}
                  title={canApplyRetention ? '执行清理' : '需管理员权限'}
                >
                  执行清理
                </Button>
              </Popconfirm>
            </Space>
          }
        >
          <div className="retention-layout">
            <div className="retention-policy-panel">
              <div className="retention-field-grid">
                <label>
                  <span>保留天数</span>
                  <InputNumber
                    min={1}
                    value={effectiveRetentionForm.retain_days}
                    onChange={(value) => setRetentionForm((current) => ({ ...current, retain_days: Number(value || 1) }))}
                  />
                </label>
                <label>
                  <span>最低保留</span>
                  <InputNumber
                    min={0}
                    value={effectiveRetentionForm.retain_minimum}
                    onChange={(value) => setRetentionForm((current) => ({ ...current, retain_minimum: Number(value || 0) }))}
                  />
                </label>
                <label className="switch-field">
                  <span>包含运行中</span>
                  <Switch
                    checked={effectiveRetentionForm.include_running}
                    onChange={(checked) => setRetentionForm((current) => ({ ...current, include_running: checked }))}
                  />
                </label>
              </div>
              <div className="retention-protection-list">
                <div><ShieldCheck size={14} /><span>测试引用保护</span><strong>{activeRetention?.protected_test_runs || 0}</strong></div>
                <div><ShieldCheck size={14} /><span>最新运行保护</span><strong>{activeRetention?.protected_minimum_runs || 0}</strong></div>
                <div><ShieldCheck size={14} /><span>运行中保护</span><strong>{activeRetention?.protected_running_runs || 0}</strong></div>
              </div>
            </div>
            <div className="retention-result-panel">
              <div className="retention-metrics retention-impact-metrics">
                <div><strong>{activeRetention?.total_runs || 0}</strong><span>总运行</span></div>
                <div><strong>{activeRetention?.retained_runs || 0}</strong><span>将保留</span></div>
                {retentionImpactMetrics.map((item) => (
                  <div key={item.label}><strong>{formatNumber(item.value)}</strong><span>{item.label}</span></div>
                ))}
              </div>
              <div className="retention-cutoff">
                <span>清理边界</span>
                <strong>{formatDate(activeRetention?.cutoff_at)}</strong>
                <Tag color={activeRetention?.dry_run === false ? 'success' : 'processing'}>
                  {activeRetention?.dry_run === false ? '已执行' : '预览'}
                </Tag>
              </div>
              <div className="retention-candidates">
                {(activeRetention?.candidate_runs || []).slice(0, 8).map((candidate) => (
                  <div key={candidate.id}>
                    <span>{candidate.id}</span>
                    <strong>{candidate.agent_id}</strong>
                    {runStatusTag(candidate.status)}
                    <em>{formatDate(candidate.ended_at || candidate.started_at)}</em>
                  </div>
                ))}
                {!runRetention.isLoading && !(activeRetention?.candidate_runs || []).length && (
                  <div className="mini-empty compact">当前策略下没有可清理运行。</div>
                )}
              </div>
            </div>
          </div>
        </PageSurface>
        <PageSurface
          className="upload-quota-surface"
          title="上传配额"
          description={`统一约束会话附件和${productTerms.businessMaterial}，避免单租户无限占用存储。`}
          actions={
            uploadQuota.data && (
              <Tag color={uploadQuota.data.usage_percent >= 90 ? 'error' : uploadQuota.data.usage_percent >= 75 ? 'warning' : 'success'}>
                {uploadQuota.data.usage_percent}%
              </Tag>
            )
          }
        >
          <div className="upload-quota-layout">
            <Progress
              percent={uploadQuota.data?.usage_percent || 0}
              status={(uploadQuota.data?.usage_percent || 0) >= 90 ? 'exception' : 'normal'}
              strokeColor={(uploadQuota.data?.usage_percent || 0) >= 75 ? '#b76512' : '#0f6f62'}
            />
            <div className="retention-metrics">
              <div><strong>{formatBytes(uploadQuota.data?.used_bytes || 0)}</strong><span>已使用</span></div>
              <div><strong>{formatBytes(uploadQuota.data?.remaining_bytes || 0)}</strong><span>剩余额度</span></div>
              <div><strong>{formatBytes(uploadQuota.data?.attachment_bytes || 0)}</strong><span>会话附件</span></div>
              <div><strong>{formatBytes(uploadQuota.data?.knowledge_bytes || 0)}</strong><span>{productTerms.businessMaterial}</span></div>
            </div>
          </div>
        </PageSurface>
        <PageSurface
          className="runtime-state-surface"
          title="状态存储容量"
          description="只读检查运行检查点、状态存储的容量、位置和维护风险。"
          actions={
            runtimeState.data && (
              <Tag color={runtimeState.data.status === 'healthy' ? 'success' : 'warning'}>
                {runtimeState.data.backend}
              </Tag>
            )
          }
        >
          <div className="runtime-state-layout">
            <div className="retention-metrics">
              <div><strong>{formatBytes(runtimeState.data?.runtime_state_bytes || 0)}</strong><span>运行态占用</span></div>
              <div><strong>{formatBytes(runtimeState.data?.checkpoint_bytes || 0)}</strong><span>检查点文件</span></div>
              <div><strong>{formatBytes(runtimeState.data?.store_bytes || 0)}</strong><span>状态存储文件</span></div>
              <div><strong>{runtimeState.data?.store_items || 0}</strong><span>状态条目</span></div>
            </div>
            <div className="runtime-state-grid">
              <div><span>运行态目录</span><strong>{runtimeState.data?.state_dir || '-'}</strong></div>
              <div><span>检查点数据库</span><strong>{runtimeState.data?.checkpoint_exists ? runtimeState.data.checkpoint_db : '未创建'}</strong></div>
              <div><span>状态数据库</span><strong>{runtimeState.data?.store_exists ? runtimeState.data.store_db : '未创建'}</strong></div>
              <div><span>检查点记录</span><strong>{runtimeState.data?.checkpoints || 0}</strong></div>
              <div><span>状态写入</span><strong>{runtimeState.data?.checkpoint_writes || 0}</strong></div>
            </div>
            <div className="runtime-state-notes">
              {(runtimeState.data?.warnings || []).length ? (
                runtimeState.data?.warnings.map((item) => <Tag color="warning" key={item}>{visibleRuntimeText(item)}</Tag>)
              ) : (
                <Tag color="success">当前运行态存储未触发维护告警</Tag>
              )}
            </div>
          </div>
        </PageSurface>
      </section>
    </WorkspacePage>
  );
}
