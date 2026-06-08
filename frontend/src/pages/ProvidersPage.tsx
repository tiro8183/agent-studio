import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Popconfirm, Space, Table, Tag, Tooltip } from 'antd';
import {
  Building2,
  Cable,
  CheckCircle2,
  Globe2,
  ListChecks,
  Network,
  Plus,
  Trash2,
} from 'lucide-react';
import { EntityCell, StatusTag, WorkspacePage } from '../components/ui';
import { api } from '../services/api';
import { canAtLeast } from '../services/authz';
import {
  isCustomProviderType,
  providerKind,
  providerKindLabel,
  protocolLabel,
  providerTypeLabel,
  type ProviderRegion,
} from '../services/providerCatalog';
import type { Agent, LLMConfig } from '../types/domain';
import { LlmConfigDrawer } from './admin/LlmConfigDrawer';

const llmCheckMeta = {
  healthy: { label: '可用', color: 'success' },
  failed: { label: '异常', color: 'error' },
  unchecked: { label: '未检测', color: 'default' },
};

const providerEntryCopy: Record<ProviderRegion, { title: string; description: string; cta: string }> = {
  domestic: {
    title: '国内预设',
    description: '百炼、DeepSeek、火山方舟、智谱、千帆等，只预填连接方式和协议边界。',
    cta: '选择国内通道',
  },
  custom: {
    title: '自定义厂商',
    description: '内部模型网关、聚合服务、Moonshot、硅基流动或任意兼容接口。',
    cta: '配置自定义厂商',
  },
  global: {
    title: '海外官方',
    description: 'OpenAI、Anthropic、Google 官方协议通道，模型 ID 以控制台为准。',
    cta: '选择海外通道',
  },
};

function getLlmCheckMeta(status: LLMConfig['last_check_status']) {
  return llmCheckMeta[status] || llmCheckMeta.unchecked;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

function providerRiskTags(item: LLMConfig) {
  const tags: Array<{ label: string; color: 'default' | 'error' | 'warning' }> = [];
  if (!item.api_key_configured) tags.push({ label: '缺少 API Key', color: 'error' });
  if (!item.default_model) tags.push({ label: '缺少默认模型', color: 'error' });
  if (!item.available_models.length) tags.push({ label: '可调用模型为空', color: 'warning' });
  if (item.status !== 'active') tags.push({ label: '停用', color: 'default' });
  if (item.last_check_status === 'failed') tags.push({ label: '连通异常', color: 'error' });
  if (item.last_check_status === 'unchecked') tags.push({ label: '未检测', color: 'warning' });
  return tags;
}

type ProviderUsage = {
  primary: number;
  subagents: number;
  published: number;
  unpublished: number;
  inactive: number;
  names: string[];
  publishedNames: string[];
};

function emptyProviderUsage(): ProviderUsage {
  return {
    primary: 0,
    subagents: 0,
    published: 0,
    unpublished: 0,
    inactive: 0,
    names: [],
    publishedNames: [],
  };
}

function addProviderUsage(usage: ProviderUsage, agent: Agent, target: 'primary' | 'subagents') {
  usage[target] += 1;
  usage[agent.status] += 1;
  if (!usage.names.includes(agent.name)) usage.names.push(agent.name);
  if (agent.status === 'published' && !usage.publishedNames.includes(agent.name)) {
    usage.publishedNames.push(agent.name);
  }
}

function providerOnlineImpactTag(usage?: ProviderUsage) {
  const count = usage?.published || 0;
  return (
    <Tag color={count ? 'error' : 'default'}>
      {count ? `影响已上线 ${count}` : '未影响已上线'}
    </Tag>
  );
}

export default function ProvidersPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LLMConfig | null>(null);
  const [initialPresetRegion, setInitialPresetRegion] = useState<ProviderRegion>('custom');
  const [providerFilter, setProviderFilter] = useState<'all' | ProviderRegion | 'inactive'>('all');
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const llms = useQuery({ queryKey: ['llms'], queryFn: api.listLlms });
  const agents = useQuery({ queryKey: ['agents'], queryFn: api.listAgents });
  const canManageProviders = canAtLeast(me.data?.membership.role, 'admin');
  const providers = llms.data || [];
  const agentsData = agents.data || [];
  const providerStats = useMemo(() => {
    const active = providers.filter((item) => item.status === 'active').length;
    const configuredKeys = providers.filter((item) => item.api_key_configured).length;
    const healthy = providers.filter((item) => item.last_check_status === 'healthy').length;
    const failed = providers.filter((item) => item.last_check_status === 'failed').length;
    const unchecked = providers.filter((item) => item.last_check_status === 'unchecked').length;
    const modelCount = providers.reduce((sum, item) => sum + item.available_models.length, 0);
    const missingKey = providers.filter((item) => item.status === 'active' && !item.api_key_configured).length;
    const custom = providers.filter((item) => isCustomProviderType(item.provider_type)).length;
    const domestic = providers.filter((item) => providerKind(item) === 'domestic').length;
    const global = providers.filter((item) => providerKind(item) === 'global').length;
    return {
      active,
      configuredKeys,
      custom,
      domestic,
      failed,
      global,
      healthy,
      missingKey,
      modelCount,
      total: providers.length,
      unchecked,
    };
  }, [providers]);
  const providerUsage = useMemo(() => {
    const usage = new Map<string, ProviderUsage>();
    providers.forEach((item) => usage.set(item.id, emptyProviderUsage()));
    agentsData.forEach((agent) => {
      const main = usage.get(agent.llm_config_id);
      if (main) {
        addProviderUsage(main, agent, 'primary');
      }
      agent.subagents.forEach((subagent) => {
        const id = subagent.llm_config_id || agent.llm_config_id;
        const target = usage.get(id);
        if (target) {
          addProviderUsage(target, agent, 'subagents');
        }
      });
    });
    return usage;
  }, [agentsData, providers]);
  const publishedProviderBindings = useMemo(
    () => Array.from(providerUsage.values()).reduce((sum, item) => sum + item.published, 0),
    [providerUsage],
  );
  const filteredProviders = useMemo(() => {
    if (providerFilter === 'inactive') return providers.filter((item) => item.status !== 'active');
    if (providerFilter === 'all') return providers;
    return providers.filter((item) => item.status === 'active' && providerKind(item) === providerFilter);
  }, [providerFilter, providers]);
  const providerRiskItems = useMemo(() => (
    providers
      .map((item) => ({ item, tags: providerRiskTags(item), usage: providerUsage.get(item.id) }))
      .filter(({ tags }) => tags.length > 0)
      .sort((a, b) => (
        (b.usage?.published || 0) - (a.usage?.published || 0)
        || Number(!b.item.api_key_configured) - Number(!a.item.api_key_configured)
        || Number(b.item.last_check_status === 'failed') - Number(a.item.last_check_status === 'failed')
        || Number(b.item.last_check_status === 'unchecked') - Number(a.item.last_check_status === 'unchecked')
        || a.item.name.localeCompare(b.item.name)
      ))
      .slice(0, 5)
  ), [providerUsage, providers]);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['llms'] });
    queryClient.invalidateQueries({ queryKey: ['agents'] });
    queryClient.invalidateQueries({ queryKey: ['agent-completeness'] });
    queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
  };

  const save = useMutation({
    mutationFn: (values: Partial<LLMConfig>) => {
      return editing ? api.updateLlm(editing.id, values) : api.createLlm(values);
    },
    onSuccess: () => {
      message.success('模型通道已保存');
      setOpen(false);
      refresh();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '模型通道保存失败');
    },
  });

  const check = useMutation({
    mutationFn: (id: string) => api.checkLlm(id),
    onSuccess: (result) => {
      if (result.status === 'healthy') {
        message.success('模型通道检测通过');
      } else {
        message.error(`模型通道检测失败：${result.message}`);
      }
      refresh();
    },
  });

  const openEditor = (record?: LLMConfig, region: ProviderRegion = 'custom') => {
    if (!canManageProviders) {
      message.warning('当前角色只能查看模型通道。');
      return;
    }
    setEditing(record || null);
    setInitialPresetRegion(record ? 'domestic' : region);
    setOpen(true);
  };

  return (
    <WorkspacePage
      className="providers-page"
      icon={<Cable size={14} />}
      eyebrow="模型接入"
      title="模型接入"
      description="管理 Agent 可绑定的模型连接。这里只维护接入协议、密钥、可用模型、连通检测和 Agent 影响，不维护价格。"
      actions={
        <Button
          type="primary"
          icon={<Plus size={16} />}
          disabled={!canManageProviders}
          title={canManageProviders ? '新增自定义厂商' : '需管理员权限'}
          onClick={() => openEditor(undefined, 'custom')}
        >
          新增自定义厂商
        </Button>
      }
    >
      <section className="provider-command-board" aria-label="模型通道治理">
        <div className="provider-command-copy">
          <span>模型通道治理</span>
          <strong>平台只管理模型接入，不参与计价。</strong>
          <p>自定义 OpenAI-compatible 厂商、内部网关和第三方聚合服务是一等入口；国内/海外预设只负责快速填充连接字段。</p>
        </div>
        <div className="provider-command-actions" aria-label="新增模型通道">
          {(['custom', 'domestic', 'global'] as ProviderRegion[]).map((region) => {
            const copy = providerEntryCopy[region];
            const count = region === 'domestic'
              ? providerStats.domestic
              : region === 'global'
                ? providerStats.global
                : providerStats.custom;
            const Icon = region === 'domestic' ? Building2 : region === 'global' ? Globe2 : Network;
            return (
              <button
                type="button"
                className={`provider-command-action ${region}`}
                key={region}
                disabled={!canManageProviders}
                onClick={() => openEditor(undefined, region)}
                title={canManageProviders ? copy.description : '需管理员权限'}
              >
                <Icon size={16} />
                <span>{copy.title}</span>
                <strong>{count}</strong>
                <em>{copy.cta}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="provider-console-grid">
        <div className="provider-ledger-panel">
          <div className="provider-panel-head provider-ledger-command">
            <div>
              <span>模型通道清单</span>
              <strong>自定义厂商优先；预设只负责填充连接字段，维护前先确认 Agent 影响。</strong>
            </div>
            <div className="provider-source-inline" aria-label="维护权限">
              <Tag color={canManageProviders ? 'success' : 'default'}>{canManageProviders ? '管理员可维护' : '只读视图'}</Tag>
            </div>
          </div>

          <div className="provider-governance-strip compact" aria-label="模型接入状态">
            {[
              { label: '可绑定通道', value: `${providerStats.active}/${providerStats.total}`, detail: `${providerStats.healthy} 个连通可用`, tone: 'neutral' },
              { label: '自定义厂商', value: providerStats.custom, detail: '内部网关 / 第三方聚合 / OpenAI-compatible', tone: 'brand' },
              { label: '可调用模型', value: providerStats.modelCount, detail: '供 Agent 绑定', tone: 'neutral' },
              { label: '密钥状态', value: `${providerStats.configuredKeys}/${providerStats.total}`, detail: providerStats.missingKey ? `${providerStats.missingKey} 个缺少 API Key` : '密钥完整', tone: providerStats.missingKey ? 'danger' : 'success' },
              { label: '已上线影响', value: publishedProviderBindings, detail: '正在依赖模型通道', tone: publishedProviderBindings ? 'warning' : 'neutral' },
            ].map((item) => (
              <div className={item.tone} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <em>{item.detail}</em>
              </div>
            ))}
          </div>

          <div className="provider-filter-bar">
            {[
              { key: 'all' as const, label: '全部', count: providers.length },
              { key: 'custom' as const, label: '自定义厂商', count: providers.filter((item) => providerKind(item) === 'custom').length },
              { key: 'domestic' as const, label: '国内预设', count: providers.filter((item) => providerKind(item) === 'domestic').length },
              { key: 'global' as const, label: '海外官方', count: providers.filter((item) => providerKind(item) === 'global').length },
              { key: 'inactive' as const, label: '停用', count: providers.filter((item) => item.status !== 'active').length },
            ].map((item) => (
              <button
                type="button"
                className={providerFilter === item.key ? 'active' : ''}
                key={item.key}
                onClick={() => setProviderFilter(item.key)}
              >
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </button>
            ))}
          </div>
          <div className="provider-responsive-list">
            {filteredProviders.map((record) => {
              const usage = providerUsage.get(record.id);
              const usageCount = (usage?.primary || 0) + (usage?.subagents || 0);
              return (
                <div className="provider-responsive-item" key={record.id}>
                  <div>
                    <EntityCell title={record.name} subtitle={record.base_url || '官方接口'} />
                    <Space size={4} wrap>
                      <Tag>{providerTypeLabel(record.provider_type)}</Tag>
                      <Tag>{providerKindLabel(record)}</Tag>
                      <Tag>{protocolLabel(record)}</Tag>
                      {record.last_check_status === 'failed' && <Tag color="error">连通异常</Tag>}
                      {providerOnlineImpactTag(usage)}
                      <Tag color={record.status === 'active' ? 'success' : 'default'}>
                        {record.status === 'active' ? '启用' : '停用'}
                      </Tag>
                      <StatusTag status={Boolean(record.api_key_configured)} trueLabel="已配置密钥" falseLabel="未配置密钥" />
                    </Space>
                  </div>
                  <div className="provider-responsive-meta">
                    <span>默认模型：{record.default_model || '-'}</span>
                    <span>可调用模型：{record.available_models.length} 个</span>
                    <span>绑定 Agent：{usageCount} 个，已上线 {usage?.published || 0} 个</span>
                    <span>最近检测：{formatDate(record.last_checked_at)}</span>
                  </div>
                  <div className="provider-responsive-actions">
                    <Tag color={getLlmCheckMeta(record.last_check_status).color}>
                      {getLlmCheckMeta(record.last_check_status).label}
                    </Tag>
                    <Button size="small" disabled={!canManageProviders} onClick={() => openEditor(record)}>编辑</Button>
                    <Button
                      size="small"
                      disabled={!canManageProviders}
                      loading={check.isPending}
                      onClick={() => check.mutate(record.id)}
                    >
                      连通检测
                    </Button>
                  </div>
                </div>
              );
            })}
            {!llms.isLoading && !filteredProviders.length && (
              <div className="mini-empty">暂无匹配的模型通道。</div>
            )}
          </div>
          <Table
            rowKey="id"
            loading={llms.isLoading}
            dataSource={filteredProviders}
            pagination={{ pageSize: 8 }}
            scroll={{ x: 1280 }}
            columns={[
            {
              title: '通道',
              dataIndex: 'name',
              fixed: 'left',
              width: 280,
              render: (_, record: LLMConfig) => (
                <EntityCell title={record.name} subtitle={record.base_url || '官方接口'} />
              ),
            },
            {
              title: '类型',
              dataIndex: 'provider_type',
              width: 170,
              render: (value, record: LLMConfig) => (
                <Space size={4} wrap>
                  <Tag>{providerTypeLabel(value)}</Tag>
                  <Tag>{providerKindLabel(record)}</Tag>
                </Space>
              ),
            },
            {
              title: '协议',
              width: 160,
              render: (_, record: LLMConfig) => <Tag>{protocolLabel(record)}</Tag>,
            },
            {
              title: '默认模型',
              dataIndex: 'default_model',
              width: 210,
              render: (value, record: LLMConfig) => (
                <Space size={4} wrap>
                  <Tag color={providerKind(record) === 'custom' ? 'green' : 'default'}>{value || '-'}</Tag>
                  {providerKind(record) === 'custom' && <Tag>自定义厂商</Tag>}
                </Space>
              ),
            },
            {
              title: '可调用模型',
              width: 260,
              render: (_, record: LLMConfig) => (
                <Space size={4} wrap>
                  <Tag>{record.available_models.length} 个模型</Tag>
                  {record.available_models.slice(0, 3).map((model) => <Tag key={model.name}>{model.name}</Tag>)}
                  {record.available_models.length > 3 && <Tag>+{record.available_models.length - 3}</Tag>}
                  {record.available_models.some((model) => model.is_reasoning_model) && <span>含推理模型</span>}
                </Space>
              ),
            },
            {
              title: '绑定 Agent',
              width: 190,
              render: (_, record: LLMConfig) => {
                const usage = providerUsage.get(record.id);
                const primary = usage?.primary || 0;
                const subagents = usage?.subagents || 0;
                const total = primary + subagents;
                return (
                  <Tooltip title={(usage?.names || []).slice(0, 6).join('、') || '暂未绑定 Agent'}>
                    <Space size={4} wrap>
                      <Tag color={total ? 'processing' : 'default'}>{total} 个绑定</Tag>
                      {providerOnlineImpactTag(usage)}
                      {subagents > 0 && <Tag>{subagents} 个协作角色</Tag>}
                    </Space>
                  </Tooltip>
                );
              },
            },
            {
              title: '密钥',
              dataIndex: 'api_key_configured',
              width: 110,
              render: (value) => <StatusTag status={Boolean(value)} trueLabel="已配置" falseLabel="未配置" />,
            },
            {
              title: '连通检测',
              dataIndex: 'last_check_status',
              width: 110,
              render: (value, record: LLMConfig) => (
                <Tooltip title={record.last_check_message || getLlmCheckMeta(value).label}>
                  <Tag color={getLlmCheckMeta(value).color}>
                    {getLlmCheckMeta(value).label}
                  </Tag>
                </Tooltip>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value) => <StatusTag status={value} />,
            },
            {
              title: '最近检测',
              dataIndex: 'last_checked_at',
              width: 180,
              render: formatDate,
            },
            {
              title: '操作',
              width: 220,
              render: (_, record: LLMConfig) => (
                <Space>
                  <Button type="link" disabled={!canManageProviders} onClick={() => openEditor(record)}>编辑</Button>
                  <Button
                    type="link"
                    disabled={!canManageProviders}
                    loading={check.isPending}
                    onClick={() => check.mutate(record.id)}
                  >
                    连通检测
                  </Button>
                  <Popconfirm
                    title="确定删除该模型通道？"
                    description="仍被 Agent、协作角色、上线版本、存量运行或模型调用记录引用时后端会拒绝删除。"
                    onConfirm={async () => {
                      try {
                        await api.deleteLlm(record.id);
                        message.success('模型通道已删除');
                        refresh();
                      } catch (error) {
                        message.error(error instanceof Error ? error.message : '模型通道删除失败');
                      }
                    }}
                    disabled={!canManageProviders}
                  >
                    <Button type="link" danger disabled={!canManageProviders} icon={<Trash2 size={14} />}>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
            ]}
          />
        </div>

        <aside className="provider-inspector-panel">
          <section>
            <div className="provider-panel-head compact">
              <div>
                <span>通道审阅</span>
                <strong>优先处理会影响上线 Agent 的连接问题。</strong>
              </div>
            </div>
            {llms.isLoading ? (
              <div className="mini-empty">正在加载模型通道状态...</div>
            ) : providerRiskItems.length > 0 ? (
              <div className="provider-risk-list">
                {providerRiskItems.map(({ item, tags, usage }) => (
                  <button
                    type="button"
                    className="provider-risk-item"
                    key={item.id}
                    disabled={!canManageProviders}
                    onClick={() => openEditor(item)}
                    title={canManageProviders ? '编辑模型通道' : '需管理员权限'}
                  >
                    <div className="provider-risk-head">
                      <span>{item.name}</span>
                      <Tag color={getLlmCheckMeta(item.last_check_status).color}>
                        {getLlmCheckMeta(item.last_check_status).label}
                      </Tag>
                    </div>
                    <div className="provider-risk-meta">
                      <span><Globe2 size={13} /> {providerTypeLabel(item.provider_type)}</span>
                      <span><Cable size={13} /> {item.default_model || '未设置默认模型'}</span>
                      <span><ListChecks size={13} /> {item.available_models.length} 个可调用模型</span>
                    </div>
                    <div className="provider-impact-row">
                      {providerOnlineImpactTag(usage)}
                      <span>
                        {(usage?.publishedNames || []).slice(0, 3).join('、') || '暂未绑定已上线 Agent'}
                      </span>
                    </div>
                    <div className="provider-risk-checks">
                      {tags.map((tag) => <Tag color={tag.color} key={tag.label}>{tag.label}</Tag>)}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="provider-empty-state">
                <CheckCircle2 size={18} />
                <strong>当前没有待处理通道风险</strong>
                <span>启用接入均完成密钥、可调用模型和连通性基础配置。</span>
              </div>
            )}
          </section>

          <section>
            <div className="provider-panel-head compact">
              <div>
                <span>Agent 依赖</span>
                <strong>变更模型通道前确认上线版本影响。</strong>
              </div>
            </div>
            <div className="provider-status-ledger">
              <div>
                <span>可绑定</span>
                <strong>{providerStats.active}/{providerStats.total}</strong>
                <em>{providerStats.healthy} 个已通过连通检测</em>
              </div>
              <div>
                <span>已上线 Agent</span>
                <strong>{publishedProviderBindings}</strong>
                <em>正在依赖模型通道</em>
              </div>
              <div>
                <span>通道结构</span>
                <strong>{providerStats.custom}/{providerStats.domestic}/{providerStats.global}</strong>
                <em>自定义 / 国内预设 / 海外官方</em>
              </div>
              <div>
                <span>模型范围</span>
                <strong>{providerStats.modelCount}</strong>
                <em>供 Agent 绑定</em>
              </div>
              <div className={providerStats.missingKey ? 'danger' : 'success'}>
                <span>密钥配置</span>
                <strong>{providerStats.configuredKeys}/{providerStats.total}</strong>
                <em>{providerStats.missingKey ? `${providerStats.missingKey} 个缺少 API Key` : '密钥状态完整'}</em>
              </div>
              <div className={providerStats.failed ? 'danger' : providerStats.unchecked ? 'warning' : 'success'}>
                <span>连通检测</span>
                <strong>{providerStats.healthy}</strong>
                <em>{providerStats.failed} 异常 / {providerStats.unchecked} 未检测</em>
              </div>
            </div>
          </section>
        </aside>
      </section>

      <LlmConfigDrawer
        open={open}
        editing={editing}
        initialPresetRegion={initialPresetRegion}
        saving={save.isPending}
        onClose={() => setOpen(false)}
        onSubmit={(payload) => save.mutate(payload)}
      />
    </WorkspacePage>
  );
}
