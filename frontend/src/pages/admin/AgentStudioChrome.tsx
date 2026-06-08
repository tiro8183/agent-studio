import { useMemo } from 'react';
import { Button, Popconfirm, Select, Space, Tag } from 'antd';
import {
  CheckCircle2,
  CircleAlert,
  ListChecks,
  Plus,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import type { Agent } from '../../types/domain';
import type { AgentPreflightCheck } from '../../types/domain';
import {
  agentReleaseLabel as lifecycleReleaseLabel,
  agentStudioObjectDetail,
  agentStudioObjectLabel,
} from '../../services/agentLifecycle';
import { agentStatusMeta, shortHash, studioSteps, type StudioStepKey } from './agentStudioModel';

function studioStatusLabel(agent: Agent | null) {
  return agentStudioObjectLabel(agent);
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
    <aside className="blueprint-rail">
      <div className="rail-header">
        <span>当前服务</span>
        <Select
          showSearch
          className="blueprint-service-select"
          value={editingAgent?.id}
          placeholder="选择 Agent 服务"
          options={serviceOptions}
          optionFilterProp="label"
          disabled={!agents.length}
          onChange={(id) => {
            const next = agents.find((agent) => agent.id === id);
            if (next) onSelect(next);
          }}
        />
      </div>
      <div className="rail-actions">
        <Button
          type="primary"
          icon={<Plus size={16} />}
          disabled={!canEdit}
          title={canEdit ? '新建服务' : '需编辑权限'}
          onClick={onCreate}
        >
          新建服务
        </Button>
        {editingAgent && (
          <Popconfirm title="确定删除这个 Agent？" onConfirm={onDelete} disabled={!canEdit}>
            <Button
              danger
              icon={<Trash2 size={14} />}
              disabled={!canEdit}
              title={canEdit ? '删除当前 Agent' : '需编辑权限'}
            >
              删除
            </Button>
          </Popconfirm>
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
  onOpenManifest,
  onOpenPreflight,
  onDeactivate,
}: AgentStudioHeaderProps) {
  const objectStateLabel = studioStatusLabel(editingAgent);
  const releaseText = lifecycleReleaseLabel(editingAgent, Boolean(editingAgent?.config_pending_publish));
  const objectDetail = agentStudioObjectDetail(editingAgent, hasUnsavedChanges, Boolean(editingAgent?.config_pending_publish));
  return (
    <div className="inline-builder-header">
      <div className="studio-object-title">
        <div className="eyebrow"><ListChecks size={14} /> 服务配置</div>
        <h2>{editingAgent ? editingAgent.name : '新建 Agent 服务'}</h2>
        <p className="studio-object-state-note">{objectDetail}</p>
        <div className="studio-object-meta">
          <Tag color={editingAgent ? agentStatusMeta[editingAgent.status]?.color : 'default'}>
            {objectStateLabel}
          </Tag>
          <span>{releaseText}</span>
          <span>{editingAgent?.model ? `模型通道 ${editingAgent.model}` : '未绑定模型通道'}</span>
        </div>
      </div>
      <Space className="studio-action-bar">
        <Button icon={<ListChecks size={16} />} disabled={!editingAgent} onClick={onOpenManifest}>上线版本</Button>
        <Button icon={<Stethoscope size={16} />} disabled={!editingAgent} onClick={onOpenPreflight}>上线检查</Button>
        {editingAgent?.status === 'published' && (
          <Button
            danger
            loading={isDeactivating}
            disabled={!canEdit}
            title={canEdit ? '停用已上线 Agent' : '需编辑权限'}
            onClick={onDeactivate}
          >
            停用
          </Button>
        )}
        <Button
          type="default"
          htmlType="submit"
          loading={isSaving}
          disabled={!canEdit}
          title={canEdit ? '保存配置；已上线版本不受影响' : '需编辑权限'}
        >
          保存配置
        </Button>
      </Space>
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
    <nav className="studio-process-bar" aria-label="Agent 配置分区">
      {studioSteps.map((step, index) => (
        <button
          type="button"
          className={[
            'studio-step-pill',
            activeStep === step.key ? 'active' : '',
            blockerCounts[step.key] ? 'has-blocker' : '',
          ].filter(Boolean).join(' ')}
          key={step.key}
          onClick={() => onChange(step.key)}
        >
          <em>{String(index + 1).padStart(2, '0')}</em>
          <span>{step.group}</span>
          <strong>{step.title}</strong>
          {Boolean(blockerCounts[step.key]) && <b>{blockerCounts[step.key]}</b>}
        </button>
      ))}
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

  return (
    <aside className="studio-inspector-panel">
      <section className={`studio-review-console ${statusTone}`}>
        <div className="studio-review-head">
          <div className="inspector-title">
            <Stethoscope size={16} />
            <span>上线审阅</span>
          </div>
          <span className={`studio-review-badge ${statusTone}`}>
            {inspector.canPublish ? '可上线' : inspector.canRun ? '可验证' : '待处理'}
          </span>
        </div>
        <div className={`studio-next-hero ${statusTone}`}>
          {inspector.canPublish ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
          <div>
            <span>下一步</span>
            <strong>{nextAction}</strong>
            <span>{inspector.blockers} 个未通过项 · {inspector.warnings} 条风险提示</span>
          </div>
        </div>
        <div className="studio-primary-action">
          {inspector.showPublishAction && (
            <Button
              type="primary"
              loading={isPublishing}
              disabled={!canEdit || inspector.hasUnsavedChanges || !inspector.canPublish}
              title={!canEdit
                ? '需编辑权限'
                : inspector.hasUnsavedChanges
                  ? '先保存配置'
                  : inspector.publishDisabledReason || '生成不可变上线版本'}
              onClick={onPublish}
            >
              {inspector.publishActionLabel}
            </Button>
          )}
          {!inspector.showPublishAction && (
            <Button
              type="primary"
              disabled={!canEdit || inspector.hasUnsavedChanges || !inspector.canRun}
              loading={testRunning}
              onClick={onRunBuilderTest}
            >
              业务验证
            </Button>
          )}
          <Button disabled={!editingAgent} onClick={onOpenPreflight}>查看检查</Button>
        </div>
        {visibleBlockers.length ? (
          <div className="studio-blocker-brief">
            <span>优先处理</span>
            <div className="inspector-blockers">
              {visibleBlockers.map((item) => (
                <button type="button" key={`${item.key}-${item.label}`} onClick={() => onFocusBlocker(item.key)}>
                  <CircleAlert size={14} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mini-empty compact">
            <CheckCircle2 size={15} />
            <span>未发现主要未通过项。</span>
          </div>
        )}
        <details className="studio-inspector-technical">
          <summary>运行证据</summary>
          {inspector.manifestError && (
            <div className="inspector-disabled-reason">
              <CircleAlert size={14} />
              <span>{inspector.manifestError}</span>
            </div>
          )}
          <div className="studio-review-state-grid">
            <div>
              <span>服务配置</span>
              <strong>{inspector.configStatusLabel}</strong>
            </div>
            <div>
              <span>运行真相</span>
              <strong>{shortHash(inspector.manifestHash)}</strong>
            </div>
          </div>
          <div className="studio-check-metrics">
            {checkMetrics.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <div className="studio-review-links">
            <Button size="small" loading={testRunning} disabled={!canEdit || inspector.hasUnsavedChanges || !inspector.canRun} onClick={onRunBuilderTest}>业务验证</Button>
            <Button size="small" loading={isSuiteRunning} disabled={!canEdit || inspector.hasUnsavedChanges || !inspector.canRun} onClick={onRunSuite}>验证服务配置</Button>
            <Button size="small" disabled={!editingAgent} onClick={onOpenManifest}>上线版本</Button>
          </div>
        </details>
      </section>
    </aside>
  );
}
