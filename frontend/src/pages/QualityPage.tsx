import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Empty, Progress, Select, Space, Table, Tag } from 'antd';
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  GitBranch,
  ListChecks,
  PlayCircle,
  RotateCw,
  ShieldCheck,
} from 'lucide-react';
import { PageSurface, TableToolbar, WorkspacePage } from '../components/ui';
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

function statusTag(value: string) {
  const meta: Record<string, { label: string; color: 'success' | 'processing' | 'error' | 'warning' | 'default' }> = {
    published: { label: agentLifecycleMeta.published.label, color: 'success' },
    unpublished: { label: agentLifecycleMeta.unpublished.label, color: 'processing' },
    inactive: { label: agentLifecycleMeta.inactive.label, color: 'default' },
    passed: { label: '通过', color: 'success' },
    failed: { label: '失败', color: 'error' },
    error: { label: '异常', color: 'error' },
    running: { label: '运行中', color: 'processing' },
    untested: { label: '未运行', color: 'default' },
  };
  const item = meta[value] || { label: value || '-', color: 'default' as const };
  return <Tag color={item.color}>{item.label}</Tag>;
}

function agentStatusLabel(value: string) {
  if (value === 'published' || value === 'unpublished' || value === 'inactive') {
    return agentLifecycleMeta[value].label;
  }
  return value || '-';
}

function freshnessTag(value: RegressionQualityCase['freshness']) {
  const meta = {
    current: { label: '当前配置', color: 'success' as const },
    stale: { label: '配置已变更', color: 'warning' as const },
    untested: { label: '未运行', color: 'default' as const },
    inactive: { label: '停用', color: 'default' as const },
  }[value];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function severityTag(value: RegressionQualityCase['severity']) {
  if (value === 'critical') return <Tag color="error">严重</Tag>;
  if (value === 'warning') return <Tag color="warning">{productTerms.riskNotice}</Tag>;
  return <Tag>信息</Tag>;
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
        <Space>
          <Button onClick={() => overview.refetch()} loading={overview.isFetching}>刷新</Button>
        </Space>
      )}
      className="quality-page"
    >
      {overview.isError && (
        <PageSurface className="quality-error-surface">
          <div className="quality-error-copy">
            <AlertTriangle size={18} />
            <div>
              <strong>上线检查数据读取失败</strong>
              <span>{overview.error instanceof Error ? overview.error.message : '请稍后重试，或检查登录状态与后端服务。'}</span>
            </div>
            <Button icon={<RotateCw size={14} />} onClick={() => overview.refetch()}>
              重新读取
            </Button>
          </div>
        </PageSurface>
      )}

      <section className="quality-command-center" aria-label="上线质量总览">
        <div className="quality-command-copy">
          <span className={`quality-gate-badge ${gateState}`}>
            {gateLabel}
          </span>
          <h2>{gate.title}</h2>
          <p>
            {gate.detail}
            {data?.generated_at ? ` 最近生成于 ${formatDate(data.generated_at)}。` : ''}
          </p>
          <div className="quality-command-actions">
            <Button icon={<PlayCircle size={15} />} disabled={!blockedAgents[0]} loading={runSuite.isPending} onClick={() => blockedAgents[0] && runSuite.mutate(blockedAgents[0].agent_id)}>
              运行上线验收
            </Button>
            <Button icon={<GitBranch size={15} />} onClick={() => goAgents(blockedAgents[0]?.agent_id || readyAgents[0]?.agent_id)}>
              打开 Agent Studio
            </Button>
          </div>
        </div>
        <div className="quality-gate-ledger">
          <div>
            <span>服务范围</span>
            <strong>{overview.isLoading ? '读取中' : `${data?.agents || 0} 个智能体`}</strong>
            <em>{overview.isLoading ? '等待后端返回' : `${data?.publish_ready_agents || 0} 个可上线`}</em>
          </div>
          <div>
            <span>验收覆盖</span>
            <strong>{overview.isLoading ? '-' : `${data?.coverage_percent || 0}%`}</strong>
            <em>{overview.isLoading ? '尚未判定' : `${data?.passed || 0}/${data?.active_cases || 0} 个当前通过`}</em>
          </div>
          <div>
            <span>待处理问题</span>
            <strong>{overview.isLoading ? '-' : `${data?.blockers || 0} 项`}</strong>
            <em>{overview.isLoading ? '等待检查结果' : `${data?.failed || 0} 失败 / ${data?.stale || 0} 过期 / ${data?.untested || 0} 未运行`}</em>
          </div>
        </div>
      </section>

      <section className="quality-workbench-grid">
        <PageSurface
          className="quality-gate-surface"
          title="质量判断"
          description="失败、需重跑和未运行用例会影响上线判断。"
        >
          <div className="quality-scoreline">
            <Progress type="circle" percent={data?.coverage_percent || 0} size={92} />
            <div>
              <strong>{gateLabel}</strong>
              <span>{data?.blocked_agents ? `${data.blocked_agents} 个 Agent 存在未通过项` : '验收结果与当前配置一致'}</span>
              <em>Agent Studio 配置变化会使旧结果失效，需要重新运行验收。</em>
            </div>
          </div>
          <div className="quality-gate-list">
            <div><span>失败/异常</span><strong>{data?.failed || 0}</strong></div>
            <div><span>运行中</span><strong>{data?.running || 0}</strong></div>
            <div><span>配置已变更</span><strong>{data?.stale || 0}</strong></div>
            <div><span>尚未运行</span><strong>{data?.untested || 0}</strong></div>
          </div>
        </PageSurface>

        <PageSurface
          className="quality-blocker-surface"
          title="问题队列"
          description="严重失败优先；配置变更和未运行用例进入补测。"
          actions={(
            <Select
              size="small"
              value={caseFilter}
              onChange={setCaseFilter}
              options={[
                { value: 'all', label: '全部' },
                { value: 'critical', label: '严重' },
                { value: 'running', label: '运行中' },
                { value: 'stale', label: '配置已变更' },
                { value: 'untested', label: '未运行' },
              ]}
            />
          )}
        >
          <div className="quality-case-list">
            {blockerCases.map((item) => (
              <button type="button" key={`${item.agent_id}-${item.id}`} onClick={() => goAgents(item.agent_id)}>
                <div>
                  {severityTag(item.severity)}
                  {statusTag(item.result_status)}
                  {freshnessTag(item.freshness)}
                  <strong>{item.name}</strong>
                </div>
                <span>{item.agent_name} · {item.reason}</span>
                <em>{item.input_preview || '无输入预览'}</em>
              </button>
            ))}
            {!blockerCases.length && (
              <div className="quality-empty-state">
                <CheckCircle2 size={18} />
                <strong>当前筛选下没有问题用例</strong>
                <span>可以切换筛选，或打开 Agent Studio 补充新的验收用例。</span>
              </div>
            )}
          </div>
        </PageSurface>
      </section>

      <PageSurface
        className="quality-agent-surface"
        title="Agent 上线状态"
        description="按 Agent 查看上线状态、验收覆盖和下一步处理对象。"
      >
        <div className="quality-agent-lanes">
          {(data?.agent_summaries || []).slice(0, 6).map((agent) => (
            <button type="button" key={agent.agent_id} className={agent.can_publish ? 'ready' : 'blocked'} onClick={() => goAgents(agent.agent_id)}>
              <div>
                {agent.can_publish ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
                <strong>{agent.agent_name}</strong>
                {statusTag(agent.status)}
              </div>
              <span>{agent.status === 'published' ? `已上线 v${agent.version}` : agentStatusLabel(agent.status)} · {agent.latest_suite_run?.is_current ? '验收匹配当前配置' : '需要复核当前配置'}</span>
              <em>{agent.passed}/{agent.total} 通过 · {agent.blockers.length ? `${agent.blockers.length} 项未通过` : '无未通过项'}</em>
            </button>
          ))}
          {!overview.isLoading && !(data?.agent_summaries || []).length && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无上线检查数据" />
          )}
        </div>
      </PageSurface>

      <PageSurface className="quality-agent-table">
        <TableToolbar
          title="验收结果表"
          description="按服务查看最近验收结果和重跑入口。"
        />
        <Table<RegressionQualityAgent>
          rowKey="agent_id"
          loading={overview.isLoading}
          dataSource={data?.agent_summaries || []}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          size="middle"
          scroll={{ x: 1080 }}
          columns={[
            {
              title: '服务',
              dataIndex: 'agent_name',
              width: 220,
              render: (_, record) => (
                <button type="button" className="link-button strong" onClick={() => goAgents(record.agent_id)}>
                  {record.agent_name}
                </button>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 96,
              render: statusTag,
            },
            {
              title: '覆盖率',
              dataIndex: 'coverage_percent',
              width: 180,
              render: (_, record) => (
                <div className="quality-progress-cell">
                  <Progress percent={record.coverage_percent} size="small" />
                  <span>{record.passed}/{record.total}</span>
                </div>
              ),
            },
            {
              title: '未通过项',
              width: 240,
              render: (_, record) => (
                <Space wrap size={[4, 4]}>
                  {record.failed > 0 && <Tag color="error">失败 {record.failed}</Tag>}
                  {record.running > 0 && <Tag color="processing">运行中 {record.running}</Tag>}
                  {record.stale > 0 && <Tag color="warning">需重跑 {record.stale}</Tag>}
                  {record.untested > 0 && <Tag>未运行 {record.untested}</Tag>}
                  {record.can_publish && <Tag color="success">可上线</Tag>}
                </Space>
              ),
            },
            {
              title: '最近套件',
              width: 220,
              render: (_, record) => record.latest_suite_run ? (
                <span>
                  {record.latest_suite_run.passed}/{record.latest_suite_run.total}
                  {' · '}
                  {record.latest_suite_run.is_current ? '当前配置' : '配置已变更'}
                  {' · '}
                  {formatDate(record.latest_suite_run.ended_at)}
                </span>
              ) : '-',
            },
            {
              title: '配置证据',
              dataIndex: 'runtime_plan_hash',
              width: 140,
              render: (value) => <Tag color="default">spec {shortHash(value)}</Tag>,
            },
            {
              title: '操作',
              width: 170,
              fixed: 'right',
              render: (_, record) => (
                <Button size="small" icon={<PlayCircle size={14} />} loading={runSuite.isPending} onClick={() => runSuite.mutate(record.agent_id)}>
                  运行验收
                </Button>
              ),
            },
          ]}
        />
      </PageSurface>
    </WorkspacePage>
  );
}
