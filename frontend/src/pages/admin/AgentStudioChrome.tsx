import { useMemo } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  ListChecks,
  Plus,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { Agent } from '../../types/domain';
import type { AgentPreflightCheck } from '../../types/domain';
import {
  agentReleaseLabel as lifecycleReleaseLabel,
  agentStudioObjectDetail,
  agentStudioObjectLabel,
} from '../../services/agentLifecycle';
import { shortHash, studioSteps, type StudioStepKey } from './agentStudioModel';

function studioStatusLabel(agent: Agent | null) {
  return agentStudioObjectLabel(agent);
}

function statusVariant(status?: Agent['status']): NonNullable<BadgeProps['variant']> {
  switch (status) {
    case 'published':
      return 'success';
    case 'inactive':
      return 'muted';
    case 'unpublished':
      return 'warning';
    default:
      return 'muted';
  }
}

interface BlueprintRailProps {
  agents: Agent[];
  editingAgent: Agent | null;
  canEdit: boolean;
  onCreate: () => void;
  onSelect: (agent: Agent) => void;
  onDelete: () => void;
}

export function AgentBlueprintRail({
  agents,
  editingAgent,
  canEdit,
  onCreate,
  onSelect,
  onDelete,
}: BlueprintRailProps) {
  const serviceOptions = useMemo(() => agents.map((agent) => ({
    value: agent.id,
    label: `${agent.name} · ${studioStatusLabel(agent)}${agent.config_pending_publish ? ' · 配置变更' : ''}`,
  })), [agents]);

  return (
    <aside className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">当前服务</span>
        <Select
          value={editingAgent?.id}
          disabled={!agents.length}
          onValueChange={(id) => {
            const next = agents.find((agent) => agent.id === id);
            if (next) onSelect(next);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="选择 Agent 服务" />
          </SelectTrigger>
          <SelectContent>
            {serviceOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Button
          disabled={!canEdit}
          title={canEdit ? '新建服务' : '需编辑权限'}
          onClick={onCreate}
        >
          <Plus /> 新建服务
        </Button>
        {editingAgent && (
          <Confirm title="确定删除这个 Agent？" onConfirm={onDelete} disabled={!canEdit}>
            <Button
              variant="destructive"
              disabled={!canEdit}
              title={canEdit ? '删除当前 Agent' : '需编辑权限'}
            >
              <Trash2 className="size-3.5" /> 删除
            </Button>
          </Confirm>
        )}
      </div>
    </aside>
  );
}

interface AgentStudioHeaderProps {
  editingAgent: Agent | null;
  canEdit: boolean;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  isDeactivating: boolean;
  onSave: () => void;
  onOpenManifest: () => void;
  onOpenPreflight: () => void;
  onDeactivate: () => void;
}

export function AgentStudioHeader({
  editingAgent,
  canEdit,
  hasUnsavedChanges,
  isSaving,
  isDeactivating,
  onSave,
  onOpenManifest,
  onOpenPreflight,
  onDeactivate,
}: AgentStudioHeaderProps) {
  const objectStateLabel = studioStatusLabel(editingAgent);
  const releaseText = lifecycleReleaseLabel(editingAgent, Boolean(editingAgent?.config_pending_publish));
  const objectDetail = agentStudioObjectDetail(editingAgent, hasUnsavedChanges, Boolean(editingAgent?.config_pending_publish));
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><ListChecks className="size-3.5" /> 服务配置</div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{editingAgent ? editingAgent.name : '新建 Agent 服务'}</h2>
        <p className="text-sm text-muted-foreground">{objectDetail}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={statusVariant(editingAgent?.status)}>{objectStateLabel}</Badge>
          <span>{releaseText}</span>
          <span>{editingAgent?.model ? `模型通道 ${editingAgent.model}` : '未绑定模型通道'}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={!editingAgent} onClick={onOpenManifest}><ListChecks /> 上线版本</Button>
        <Button variant="outline" disabled={!editingAgent} onClick={onOpenPreflight}><Stethoscope /> 上线检查</Button>
        {editingAgent?.status === 'published' && (
          <Button
            variant="destructive"
            disabled={!canEdit || isDeactivating}
            title={canEdit ? '停用已上线 Agent' : '需编辑权限'}
            onClick={onDeactivate}
          >
            {isDeactivating ? <Spinner className="text-current" /> : null} 停用
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!canEdit || isSaving}
          title={canEdit ? '保存配置；已上线版本不受影响' : '需编辑权限'}
          onClick={onSave}
        >
          {isSaving ? <Spinner className="text-current" /> : null} 保存配置
        </Button>
      </div>
    </div>
  );
}

interface StudioStepNavProps {
  activeStep: StudioStepKey;
  blockers?: AgentPreflightCheck[];
  onChange: (step: StudioStepKey) => void;
}

const stepBlockerMap: Record<string, StudioStepKey> = {
  identity: 'profile',
  model_binding: 'model',
  api_key_configured: 'model',
  provider_check: 'model',
  deepagents_runtime: 'runtime',
  runtime_configuration: 'runtime',
  runtime_manifest_guard: 'runtime',
  runtime_governance_gate: 'runtime',
  capabilities: 'capabilities',
  runtime_resources: 'capabilities',
  tool_health: 'capabilities',
  skill_health: 'capabilities',
  knowledge: 'knowledge',
  test_run: 'evaluation',
  regression_suite: 'evaluation',
  publication_metadata: 'evaluation',
};

export function StudioStepNav({ activeStep, blockers = [], onChange }: StudioStepNavProps) {
  const blockerCounts = blockers.reduce<Record<string, number>>((acc, check) => {
    if (check.passed || check.severity !== 'blocker') return acc;
    const step = stepBlockerMap[check.key] || 'runtime';
    acc[step] = (acc[step] || 0) + 1;
    return acc;
  }, {});
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Agent 配置分区">
      {studioSteps.map((step, index) => {
        const active = activeStep === step.key;
        const hasBlocker = Boolean(blockerCounts[step.key]);
        return (
          <button
            type="button"
            className={cn(
              'relative flex min-w-[8.5rem] flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
              active ? 'border-primary bg-primary/8' : 'border-border bg-card hover:border-primary/40',
              hasBlocker && !active && 'border-destructive/40',
            )}
            key={step.key}
            onClick={() => onChange(step.key)}
          >
            <em className="text-[11px] font-semibold not-italic text-muted-foreground">{String(index + 1).padStart(2, '0')}</em>
            <span className="text-[11px] text-muted-foreground">{step.group}</span>
            <strong className={cn('text-sm font-semibold', active ? 'text-primary' : 'text-foreground')}>{step.title}</strong>
            {hasBlocker && (
              <b className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">{blockerCounts[step.key]}</b>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export interface StudioInspectorState {
  canRun: boolean;
  canPublish: boolean;
  backendCanPublish: boolean;
  score: number;
  blockers: number;
  warnings: number;
  runtimeResources: number;
  missingResources: string[];
  activeCases: number;
  passedCases: number;
  regressionFailed: number;
  regressionStale: number;
  regressionUntested: number;
  regressionCoveragePercent: number;
  regressionBlockers: string[];
  runtimePlanHash: string;
  manifestHash: string;
  manifestSource: 'draft' | 'preview' | 'release';
  manifestLoading: boolean;
  manifestError: string;
  latestReleaseHash: string;
  latestReleaseManifestHash: string;
  hasRelease: boolean;
  canEnableRelease: boolean;
  hasUnsavedChanges: boolean;
  hasPendingPublish: boolean;
  showPublishAction: boolean;
  publishActionLabel: string;
  publishDisabledReason: string;
  configStatusLabel: string;
  knowledgeCount: number;
  knowledgeChunkCount: number;
  releaseKnowledgeCount: number;
  releaseKnowledgeBytes: number;
}

export function studioNextAction(inspector: StudioInspectorState, editingAgent: Agent | null) {
  const primaryBlocker = inspector.publishDisabledReason
    || inspector.regressionBlockers[0]
    || (inspector.missingResources.length ? `缺少运行依赖：${inspector.missingResources.slice(0, 3).join('、')}` : '');
  if (inspector.hasUnsavedChanges) return '先保存配置';
  if (editingAgent?.status === 'published' && !inspector.showPublishAction) return '已上线版本一致，无需上线操作';
  if (editingAgent?.status === 'inactive' && inspector.hasPendingPublish) return '配置已变更，需重新上线';
  if (inspector.canPublish) return inspector.canEnableRelease ? '可以启用上线版本' : '可以生成上线版本';
  return primaryBlocker || '处理未通过项';
}

interface StudioInspectorPanelProps {
  inspector: StudioInspectorState;
  editingAgent: Agent | null;
  canEdit: boolean;
  testRunning: boolean;
  isSuiteRunning: boolean;
  isPublishing: boolean;
  onOpenPreflight: () => void;
  onOpenManifest: () => void;
  preflightChecks?: AgentPreflightCheck[];
  onFocusBlocker: (checkKey: string) => void;
  onRunBuilderTest: () => void;
  onRunSuite: () => void;
  onPublish: () => void;
}

export function StudioInspectorPanel({
  inspector,
  editingAgent,
  canEdit,
  testRunning,
  isSuiteRunning,
  isPublishing,
  onOpenPreflight,
  onOpenManifest,
  preflightChecks = [],
  onFocusBlocker,
  onRunBuilderTest,
  onRunSuite,
  onPublish,
}: StudioInspectorPanelProps) {
  const nextAction = studioNextAction(inspector, editingAgent);
  const checkMetrics = [
    { label: '运行依赖', value: inspector.runtimeResources },
    { label: '验收用例', value: `${inspector.passedCases}/${inspector.activeCases}` },
    { label: '未通过项', value: inspector.blockers + inspector.regressionFailed },
  ];
  const visibleBlockers = [
    ...preflightChecks
      .filter((item) => !item.passed && item.severity === 'blocker')
      .map((item) => ({ key: item.key, label: `${item.label}：${item.detail}` })),
    ...inspector.missingResources.map((item) => ({ key: 'runtime_resources', label: `缺少运行依赖：${item}` })),
    ...inspector.regressionBlockers.map((item) => ({ key: 'regression_suite', label: item })),
  ].slice(0, 3);
  const statusTone = inspector.canPublish ? 'ready' : inspector.canRun ? 'warning' : 'blocked';
  const toneBorder = statusTone === 'ready' ? 'border-success/30 bg-success/6' : statusTone === 'warning' ? 'border-warning/30 bg-warning/6' : 'border-destructive/30 bg-destructive/6';
  const badgeVariant: NonNullable<BadgeProps['variant']> = statusTone === 'ready' ? 'success' : statusTone === 'warning' ? 'warning' : 'destructive';

  return (
    <aside className="space-y-3">
      <section className={cn('space-y-3 rounded-xl border p-4', toneBorder)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Stethoscope className="size-4" />
            <span>上线审阅</span>
          </div>
          <Badge variant={badgeVariant}>
            {inspector.canPublish ? '可上线' : inspector.canRun ? '可验证' : '待处理'}
          </Badge>
        </div>
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card p-3">
          {inspector.canPublish ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
          <div className="min-w-0 space-y-0.5">
            <span className="block text-xs text-muted-foreground">下一步</span>
            <strong className="block text-sm font-semibold text-foreground">{nextAction}</strong>
            <span className="block text-xs text-muted-foreground">{inspector.blockers} 个未通过项 · {inspector.warnings} 条风险提示</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {inspector.showPublishAction && (
            <Button
              disabled={!canEdit || inspector.hasUnsavedChanges || !inspector.canPublish || isPublishing}
              title={!canEdit
                ? '需编辑权限'
                : inspector.hasUnsavedChanges
                  ? '先保存配置'
                  : inspector.publishDisabledReason || '生成不可变上线版本'}
              onClick={onPublish}
            >
              {isPublishing ? <Spinner className="text-current" /> : null} {inspector.publishActionLabel}
            </Button>
          )}
          {!inspector.showPublishAction && (
            <Button
              disabled={!canEdit || inspector.hasUnsavedChanges || !inspector.canRun || testRunning}
              onClick={onRunBuilderTest}
            >
              {testRunning ? <Spinner className="text-current" /> : null} 业务验证
            </Button>
          )}
          <Button variant="outline" disabled={!editingAgent} onClick={onOpenPreflight}>查看检查</Button>
        </div>
        {visibleBlockers.length ? (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">优先处理</span>
            <div className="space-y-1.5">
              {visibleBlockers.map((item) => (
                <button
                  type="button"
                  key={`${item.key}-${item.label}`}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-xs text-foreground hover:border-primary/40"
                  onClick={() => onFocusBlocker(item.key)}
                >
                  <CircleAlert className="size-3.5 shrink-0 text-warning" />
                  <span className="min-w-0 flex-1">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-success" />
            <span>未发现主要未通过项。</span>
          </div>
        )}
        <details className="rounded-lg border border-border bg-card p-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground">运行证据</summary>
          <div className="mt-3 space-y-3">
            {inspector.manifestError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <CircleAlert className="size-3.5" />
                <span>{inspector.manifestError}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                <span className="block text-xs text-muted-foreground">服务配置</span>
                <strong className="text-sm font-semibold text-foreground">{inspector.configStatusLabel}</strong>
              </div>
              <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                <span className="block text-xs text-muted-foreground">运行真相</span>
                <strong className="text-sm font-semibold text-foreground">{shortHash(inspector.manifestHash)}</strong>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {checkMetrics.map((item) => (
                <div key={item.label} className="rounded-md bg-muted/40 px-2.5 py-1.5 text-center">
                  <span className="block text-xs text-muted-foreground">{item.label}</span>
                  <strong className="text-sm font-semibold text-foreground">{item.value}</strong>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!canEdit || inspector.hasUnsavedChanges || !inspector.canRun || testRunning} onClick={onRunBuilderTest}>
                {testRunning ? <Spinner className="text-current" /> : null} 业务验证
              </Button>
              <Button size="sm" variant="outline" disabled={!canEdit || inspector.hasUnsavedChanges || !inspector.canRun || isSuiteRunning} onClick={onRunSuite}>
                {isSuiteRunning ? <Spinner className="text-current" /> : null} 验证服务配置
              </Button>
              <Button size="sm" variant="outline" disabled={!editingAgent} onClick={onOpenManifest}>上线版本</Button>
            </div>
          </div>
        </details>
      </section>
    </aside>
  );
}
