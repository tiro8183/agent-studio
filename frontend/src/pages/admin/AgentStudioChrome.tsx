import { useMemo, useState } from 'react';
import { Button, Popconfirm, Space, Tag } from 'antd';
import {
  CheckCircle2,
  CircleAlert,
  ListChecks,
  Plus,
  Search,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import type { Agent } from '../../types/domain';
import type { AgentPreflightCheck } from '../../types/domain';
import {
  agentReleaseLabel as lifecycleReleaseLabel,
  agentReleaseStateLabel,
  agentStudioObjectDetail,
  agentStudioObjectLabel,
} from '../../services/agentLifecycle';
import { ReadinessRing } from './AgentStudioCorePanels';
import { agentStatusMeta, shortHash, studioSteps, type StudioStepKey } from './agentStudioModel';

function studioStatusLabel(agent: Agent | null) {
  return agentStudioObjectLabel(agent);
}

function studioModelRef(agent: Agent | null) {
  if (!agent) return '保存后生成 agent 标识';
  return `agent:${agent.slug || agent.id}`;
}

interface BlueprintRailProps {
  agents: Agent[];
  editingAgent: Agent | null;
  knowledgeCounts?: Record<string, number>;
  canEdit: boolean;
  onCreate: () => void;
  onSelect: (agent: Agent) => void;
  onDelete: () => void;
}

export function AgentBlueprintRail({
  agents,
  editingAgent,
  knowledgeCounts,
  canEdit,
  onCreate,
  onSelect,
  onDelete,
}: BlueprintRailProps) {
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<Agent['status'] | 'all' | 'pending_release'>('all');
  const statusCounts = useMemo(() => ({
    all: agents.length,
    pending_release: agents.filter((agent) => agent.status === 'published' && agent.config_pending_publish).length,
    unpublished: agents.filter((agent) => agent.status === 'unpublished').length,
    published: agents.filter((agent) => agent.status === 'published').length,
    inactive: agents.filter((agent) => agent.status === 'inactive').length,
  }), [agents]);
  const visibleAgents = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return agents.filter((agent) => {
      if (statusFilter === 'pending_release' && !(agent.status === 'published' && agent.config_pending_publish)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'pending_release' && agent.status !== statusFilter) return false;
      if (!query) return true;
      return (
        agent.name.toLowerCase().includes(query)
        || agent.description.toLowerCase().includes(query)
        || agent.model.toLowerCase().includes(query)
      );
    });
  }, [agents, keyword, statusFilter]);
  const selectedStatusLabel = statusFilter === 'all'
    ? '全部服务'
    : statusFilter === 'pending_release'
      ? '配置变更'
      : agentStatusMeta[statusFilter].label;

  return (
    <aside className="blueprint-rail">
      <div className="rail-header">
        <div>
          <h2>服务清单</h2>
          <p>只保留未上线、已上线、停用三种状态；上线版本由发布动作生成。</p>
        </div>
        <Button
          type="primary"
          icon={<Plus size={16} />}
          disabled={!canEdit}
          title={canEdit ? '新建服务' : '需编辑权限'}
          onClick={onCreate}
        >
          新建服务
        </Button>
      </div>
      <div className="blueprint-rail-summary" aria-label="Agent 服务概览">
        <div>
          <span>已上线</span>
          <strong>{statusCounts.published}</strong>
        </div>
        <div>
          <span>未上线</span>
          <strong>{statusCounts.unpublished}</strong>
        </div>
        <div>
          <span>停用</span>
          <strong>{statusCounts.inactive}</strong>
        </div>
      </div>
      <label className="blueprint-search">
        <Search size={14} />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索名称、场景或模型通道"
        />
      </label>
      <div className="blueprint-status-filter" aria-label="生命周期筛选">
        {[
          { key: 'all' as const, label: '全部' },
          { key: 'pending_release' as const, label: '配置变更' },
          { key: 'unpublished' as const, label: '未上线' },
          { key: 'published' as const, label: '已上线' },
          { key: 'inactive' as const, label: '停用' },
        ].map((item) => (
          <button
            type="button"
            className={statusFilter === item.key ? 'active' : ''}
            key={item.key}
            onClick={() => setStatusFilter(item.key)}
          >
            <span>{item.label}</span>
            <strong>{statusCounts[item.key]}</strong>
          </button>
        ))}
      </div>
      <div className="blueprint-filter-context">
        <span>{selectedStatusLabel}</span>
        <strong>{visibleAgents.length}</strong>
      </div>
      <div className="blueprint-list">
        {visibleAgents.map((agent) => (
          <button
            type="button"
            className={editingAgent?.id === agent.id ? 'blueprint-item active' : 'blueprint-item'}
            key={agent.id}
            onClick={() => onSelect(agent)}
          >
            <div className="blueprint-item-main">
              <strong>{agent.name}</strong>
              <span>{agent.description || '未填写业务场景'}</span>
            </div>
            <div className="blueprint-status-tags">
              <Tag color={agentStatusMeta[agent.status]?.color}>{studioStatusLabel(agent)}</Tag>
              {agent.status === 'published' && agent.config_pending_publish && <Tag color="warning">配置变更待上线</Tag>}
            </div>
            <div className="blueprint-meta">
              <em>{agent.tools?.length || 0} 工具</em>
              <em>{agent.skills?.length || 0} 能力包</em>
              <em>{agent.subagents?.length || 0} 协作角色</em>
              <em>{knowledgeCounts?.[agent.id] || 0} 资料</em>
            </div>
          </button>
        ))}
        {!visibleAgents.length && <div className="mini-empty">没有匹配的 Agent 服务</div>}
      </div>
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
  const modelRef = studioModelRef(editingAgent);
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
          <span>{modelRef}</span>
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
  releasePath: StudioReleasePathItem[];
}

export interface StudioReleasePathItem {
  key: 'save' | 'runtime' | 'validation' | 'evaluation' | 'release';
  label: string;
  passed: boolean;
  detail: string;
}

interface StudioProductionBriefProps {
  inspector: StudioInspectorState;
  editingAgent: Agent | null;
}

export function StudioProductionBrief({ inspector, editingAgent }: StudioProductionBriefProps) {
  const releaseState = agentReleaseStateLabel(editingAgent, inspector.hasPendingPublish);
  const readinessState = inspector.canPublish ? '可上线' : inspector.canRun ? '可验证' : '待处理';
  const summary = [
    {
      label: '运行真相',
      value: shortHash(inspector.manifestHash),
      meta: `${inspector.manifestSource === 'preview' ? '未保存预览' : '已保存草稿'} · ${inspector.manifestLoading ? '同步中' : inspector.manifestError ? '预览失败' : '后端 Manifest'}`,
      tone: inspector.manifestError ? 'blocked' : inspector.hasUnsavedChanges ? 'warning' : 'ready',
    },
    {
      label: '服务状态',
      value: inspector.configStatusLabel,
      meta: releaseState,
      tone: inspector.hasUnsavedChanges || inspector.hasPendingPublish ? 'warning' : 'ready',
    },
    {
      label: '上线检查',
      value: readinessState,
      meta: `${inspector.runtimeResources} 项运行依赖 · ${inspector.blockers} 未通过`,
      tone: inspector.canPublish ? 'ready' : inspector.canRun ? 'warning' : 'blocked',
    },
  ];
  return (
    <div className="studio-production-brief" aria-label="Agent 生产摘要">
      {summary.map((item) => (
        <div className={item.tone} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <em>{item.meta}</em>
        </div>
      ))}
    </div>
  );
}

interface StudioProductionPathProps {
  items: StudioReleasePathItem[];
}

export function StudioProductionPath({ items }: StudioProductionPathProps) {
  return (
    <div className="studio-production-path" aria-label="Agent 上线路径">
      <div className="studio-production-path-head">
        <span>上线门禁</span>
        <strong>保存只更新服务配置；通过检查和验收后，才会生成不可变上线版本。</strong>
      </div>
      <div className="studio-release-path studio-release-path-main">
        {items.map((item, index) => (
          <div className={item.passed ? 'passed' : ''} key={item.key}>
            <em>{index + 1}</em>
            <span>{item.label}</span>
            <strong>{item.detail}</strong>
          </div>
        ))}
      </div>
    </div>
  );
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
  const primaryBlocker = inspector.publishDisabledReason
    || inspector.regressionBlockers[0]
    || (inspector.missingResources.length ? `缺少运行依赖：${inspector.missingResources.slice(0, 3).join('、')}` : '');
  let nextAction = primaryBlocker || '处理未通过项';
  if (inspector.hasUnsavedChanges) {
    nextAction = '先保存配置';
  } else if (editingAgent?.status === 'published' && !inspector.showPublishAction) {
    nextAction = '已上线版本一致，无需上线操作';
  } else if (editingAgent?.status === 'inactive' && inspector.hasPendingPublish) {
    nextAction = '配置已变更，需重新上线';
  } else if (inspector.canPublish) {
    nextAction = inspector.canEnableRelease ? '可以启用上线版本' : '可以生成上线版本';
  }
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
  ].slice(0, 4);
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
        <div className="inspector-score">
          <ReadinessRing percent={inspector.score} size={78} />
          <div>
            <strong>{inspector.canPublish ? '检查与验收均满足' : inspector.canRun ? '可以继续验证' : '存在阻断项'}</strong>
            <span>{inspector.blockers} 个未通过项 · {inspector.warnings} 条风险提示</span>
          </div>
        </div>
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
        {inspector.manifestError && (
          <div className="inspector-disabled-reason">
            <CircleAlert size={14} />
            <span>{inspector.manifestError}</span>
          </div>
        )}
        <div className={`studio-check-next ${inspector.canPublish ? 'ready' : 'warning'}`}>
          {inspector.canPublish ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
          <div>
            <span>下一步</span>
            <strong>{nextAction}</strong>
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
        {inspector.publishDisabledReason && (
          <div className="inspector-disabled-reason">
            <CircleAlert size={14} />
            <span>{inspector.publishDisabledReason}</span>
          </div>
        )}
        <div className="studio-check-actions">
          <Button
            size="small"
            loading={testRunning}
            disabled={!canEdit || inspector.hasUnsavedChanges || !inspector.canRun}
            onClick={onRunBuilderTest}
          >
            业务验证
          </Button>
          <Button
            size="small"
            loading={isSuiteRunning}
            disabled={!canEdit || inspector.hasUnsavedChanges || !inspector.canRun}
            onClick={onRunSuite}
          >
            验证服务配置
          </Button>
        </div>
      </section>
      <section className="studio-review-evidence">
        <div className="inspector-title">
          <ListChecks size={16} />
          <span>证据与阻断项</span>
        </div>
        <div className="studio-check-metrics">
          {checkMetrics.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
        {!visibleBlockers.length ? (
          <div className="mini-empty compact">
            <CheckCircle2 size={15} />
            <span>未发现主要未通过项。</span>
          </div>
        ) : (
          <div className="inspector-blockers">
            {visibleBlockers.map((item) => (
              <button type="button" key={`${item.key}-${item.label}`} onClick={() => onFocusBlocker(item.key)}>
                <CircleAlert size={14} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="studio-review-links">
          <Button size="small" disabled={!editingAgent} onClick={onOpenPreflight}>检查明细</Button>
          <Button size="small" disabled={!editingAgent} onClick={onOpenManifest}>上线版本</Button>
        </div>
      </section>
    </aside>
  );
}
