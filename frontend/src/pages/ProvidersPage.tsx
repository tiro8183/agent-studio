import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { PageContainer, PageHeader, SectionCard } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusTag, WorkspaceMetricGrid, WorkspacePage } from '../components/ui';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { EntityCell } from '../components/ui';
import { api } from '../services/api';
import { canAtLeast } from '../services/authz';
import { workspaceApi } from '../services/workspaceApi';
import {
  isCustomProviderType,
  providerKind,
  providerKindLabel,
  protocolLabel,
  providerTypeLabel,
  type ProviderRegion,
} from '../services/providerCatalog';
import { toast } from '@/lib/toast';
import type { Agent, LLMConfig } from '../types/domain';
import { LlmConfigDrawer } from './admin/LlmConfigDrawer';

const llmCheckMeta = {
  healthy: { label: '可用', variant: 'success' as const },
  failed: { label: '异常', variant: 'destructive' as const },
  unchecked: { label: '未检测', variant: 'muted' as const },
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
  const tags: Array<{ label: string; variant: 'muted' | 'destructive' | 'warning' }> = [];
  if (!item.api_key_configured) tags.push({ label: '缺少 API Key', variant: 'destructive' });
  if (!item.default_model) tags.push({ label: '缺少默认模型', variant: 'destructive' });
  if (!item.available_models.length) tags.push({ label: '可调用模型为空', variant: 'warning' });
  if (item.status !== 'active') tags.push({ label: '停用', variant: 'muted' });
  if (item.last_check_status === 'failed') tags.push({ label: '连通异常', variant: 'destructive' });
  if (item.last_check_status === 'unchecked') tags.push({ label: '未检测', variant: 'warning' });
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

function ProviderOnlineImpactBadge({ usage }: { usage?: ProviderUsage }) {
  const count = usage?.published || 0;
  return (
    <Badge variant={count ? 'destructive' : 'muted'}>
      {count ? `影响已上线 ${count}` : '未影响已上线'}
    </Badge>
  );
}

export default function ProvidersPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LLMConfig | null>(null);
  const [initialPresetRegion, setInitialPresetRegion] = useState<ProviderRegion>('custom');
  const [providerFilter, setProviderFilter] = useState<'all' | ProviderRegion | 'inactive'>('all');
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const llms = useQuery({ queryKey: ['llms'], queryFn: api.listLlms });
  const agents = useQuery({ queryKey: ['agents'], queryFn: api.listAgents });
  const workspace = useQuery({ queryKey: ['workspace', 'asset-governance'], queryFn: workspaceApi.assetGovernance });
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
      toast.success('模型通道已保存');
      setOpen(false);
      refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '模型通道保存失败');
    },
  });

  const check = useMutation({
    mutationFn: (id: string) => api.checkLlm(id),
    onSuccess: (result) => {
      if (result.status === 'healthy') {
        toast.success('模型通道检测通过');
      } else {
        toast.error(`模型通道检测失败：${result.message}`);
      }
      refresh();
    },
  });

  const openEditor = (record?: LLMConfig, region: ProviderRegion = 'custom') => {
    if (!canManageProviders) {
      toast.warning('当前角色只能查看模型通道。');
      return;
    }
    setEditing(record || null);
    setInitialPresetRegion(record ? 'domestic' : region);
    setOpen(true);
  };

  return (
    <WorkspacePage
      icon={<Cable size={14} />}
      eyebrow="资产治理"
      title="模型通道"
      description="管理 Agent 可绑定的模型通道（Model Providers）。这里只维护接入协议、密钥、可用模型、连通检测和 Agent 影响，不维护价格。"
      actions={
        <Button
          disabled={!canManageProviders}
          title={canManageProviders ? '新增自定义厂商' : '需管理员权限'}
          onClick={() => openEditor(undefined, 'custom')}
        >
          <Plus size={16} />
          新增自定义厂商
        </Button>
      }
    >
      {/* Workspace governance summary */}
      <SectionCard
        title="模型通道治理状态"
        description="由后端 workspace read model 聚合 Model Provider 可用性和已上线 Agent 影响。"
      >
        <WorkspaceMetricGrid items={workspace.data?.metrics || []} />
      </SectionCard>

      {/* Entry point command board */}
      <SectionCard contentPadding={false}>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">模型通道治理</span>
            <strong className="text-xs font-medium text-muted-foreground">平台只管理模型接入，不参与计价。</strong>
            <p className="text-xs text-muted-foreground">
              自定义 OpenAI-compatible 厂商、内部网关和第三方聚合服务是一等入口；国内/海外预设只负责快速填充连接字段。
            </p>
          </div>
          <div className="flex flex-wrap gap-3 sm:flex-nowrap" aria-label="新增模型通道">
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
                  key={region}
                  disabled={!canManageProviders}
                  onClick={() => openEditor(undefined, region)}
                  title={canManageProviders ? copy.description : '需管理员权限'}
                  className="flex min-w-[140px] flex-1 cursor-pointer flex-col gap-1.5 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Icon size={14} />
                    {copy.title}
                  </span>
                  <strong className="text-2xl font-semibold tracking-tight text-foreground">{count}</strong>
                  <em className="text-xs not-italic text-primary">{copy.cta}</em>
                </button>
              );
            })}
          </div>
        </div>
      </SectionCard>

      {/* Main console grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        {/* Left: ledger panel */}
        <div className="flex flex-col gap-4">
          <SectionCard
            title={
              <span className="flex flex-col gap-0.5">
                <span>模型通道清单</span>
                <span className="text-xs font-normal text-muted-foreground">
                  自定义厂商优先；预设只负责填充连接字段，维护前先确认 Agent 影响。
                </span>
              </span>
            }
            actions={
              <Badge variant={canManageProviders ? 'success' : 'muted'}>
                {canManageProviders ? '管理员可维护' : '只读视图'}
              </Badge>
            }
            contentPadding={false}
          >
            {/* Governance stat strip */}
            <div className="grid grid-cols-2 gap-px overflow-hidden border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-5" aria-label="模型接入状态">
              {[
                { label: '可绑定通道', value: `${providerStats.active}/${providerStats.total}`, detail: `${providerStats.healthy} 个连通可用`, tone: 'default' as const },
                { label: '自定义厂商', value: providerStats.custom, detail: '内部网关 / 第三方聚合 / OpenAI-compatible', tone: 'default' as const },
                { label: '可调用模型', value: providerStats.modelCount, detail: '供 Agent 绑定', tone: 'default' as const },
                { label: '密钥状态', value: `${providerStats.configuredKeys}/${providerStats.total}`, detail: providerStats.missingKey ? `${providerStats.missingKey} 个缺少 API Key` : '密钥完整', tone: providerStats.missingKey ? 'destructive' as const : 'success' as const },
                { label: '已上线影响', value: publishedProviderBindings, detail: '正在依赖模型通道', tone: publishedProviderBindings ? 'warning' as const : 'default' as const },
              ].map((item) => (
                <div key={item.label} className="flex flex-col gap-1 bg-card p-4">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <strong className={`text-xl font-semibold tracking-tight ${
                    item.tone === 'destructive' ? 'text-destructive'
                    : item.tone === 'success' ? 'text-success'
                    : item.tone === 'warning' ? 'text-warning'
                    : 'text-foreground'
                  }`}>{item.value}</strong>
                  <em className="text-xs not-italic text-muted-foreground">{item.detail}</em>
                </div>
              ))}
            </div>

            {/* Filter tabs */}
            <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
              {[
                { key: 'all' as const, label: '全部', count: providers.length },
                { key: 'custom' as const, label: '自定义厂商', count: providers.filter((item) => providerKind(item) === 'custom').length },
                { key: 'domestic' as const, label: '国内预设', count: providers.filter((item) => providerKind(item) === 'domestic').length },
                { key: 'global' as const, label: '海外官方', count: providers.filter((item) => providerKind(item) === 'global').length },
                { key: 'inactive' as const, label: '停用', count: providers.filter((item) => item.status !== 'active').length },
              ].map((item) => (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => setProviderFilter(item.key)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    providerFilter === item.key
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    providerFilter === item.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>{item.count}</span>
                </button>
              ))}
            </div>

            {/* Responsive card list (mobile/compact) */}
            <div className="divide-y divide-border lg:hidden">
              {llms.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner />
                  <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
                </div>
              ) : filteredProviders.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">暂无匹配的模型通道。</div>
              ) : (
                filteredProviders.map((record) => {
                  const usage = providerUsage.get(record.id);
                  const usageCount = (usage?.primary || 0) + (usage?.subagents || 0);
                  const checkMeta = getLlmCheckMeta(record.last_check_status);
                  return (
                    <div key={record.id} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <EntityCell title={record.name} subtitle={record.base_url || '官方接口'} />
                        <Badge variant={checkMeta.variant}>{checkMeta.label}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">{providerTypeLabel(record.provider_type)}</Badge>
                        <Badge variant="outline">{providerKindLabel(record)}</Badge>
                        <Badge variant="outline">{protocolLabel(record)}</Badge>
                        {record.last_check_status === 'failed' && <Badge variant="destructive">连通异常</Badge>}
                        <ProviderOnlineImpactBadge usage={usage} />
                        <StatusBadge status={record.status} />
                        <StatusTag status={Boolean(record.api_key_configured)} trueLabel="已配置密钥" falseLabel="未配置密钥" />
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        <span>默认模型：{record.default_model || '-'}</span>
                        <span>可调用模型：{record.available_models.length} 个</span>
                        <span>绑定 Agent：{usageCount} 个，已上线 {usage?.published || 0} 个</span>
                        <span>最近检测：{formatDate(record.last_checked_at)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" disabled={!canManageProviders} onClick={() => openEditor(record)}>编辑</Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManageProviders || check.isPending}
                          onClick={() => check.mutate(record.id)}
                        >
                          {check.isPending && <Spinner className="mr-1 size-3" />}
                          连通检测
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Full table (desktop) */}
            <div className="hidden lg:block">
              {llms.isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Spinner />
                  <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
                </div>
              ) : filteredProviders.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">暂无匹配的模型通道。</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[260px]">通道</TableHead>
                      <TableHead className="w-[160px]">类型</TableHead>
                      <TableHead className="w-[140px]">协议</TableHead>
                      <TableHead className="w-[200px]">默认模型</TableHead>
                      <TableHead className="w-[240px]">可调用模型</TableHead>
                      <TableHead className="w-[180px]">绑定 Agent</TableHead>
                      <TableHead className="w-[100px]">密钥</TableHead>
                      <TableHead className="w-[100px]">连通检测</TableHead>
                      <TableHead className="w-[90px]">状态</TableHead>
                      <TableHead className="w-[170px]">最近检测</TableHead>
                      <TableHead className="w-[210px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProviders.map((record) => {
                      const usage = providerUsage.get(record.id);
                      const primary = usage?.primary || 0;
                      const subagents = usage?.subagents || 0;
                      const total = primary + subagents;
                      const checkMeta = getLlmCheckMeta(record.last_check_status);
                      return (
                        <TableRow key={record.id}>
                          <TableCell>
                            <EntityCell title={record.name} subtitle={record.base_url || '官方接口'} />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline">{providerTypeLabel(record.provider_type)}</Badge>
                              <Badge variant="outline">{providerKindLabel(record)}</Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{protocolLabel(record)}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant={providerKind(record) === 'custom' ? 'success' : 'outline'}>
                                {record.default_model || '-'}
                              </Badge>
                              {providerKind(record) === 'custom' && (
                                <Badge variant="outline">自定义厂商</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline">{record.available_models.length} 个模型</Badge>
                              {record.available_models.slice(0, 3).map((model) => (
                                <Badge key={model.name} variant="muted">{model.name}</Badge>
                              ))}
                              {record.available_models.length > 3 && (
                                <Badge variant="muted">+{record.available_models.length - 3}</Badge>
                              )}
                              {record.available_models.some((model) => model.is_reasoning_model) && (
                                <span className="text-xs text-muted-foreground">含推理模型</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Tooltip content={(usage?.names || []).slice(0, 6).join('、') || '暂未绑定 Agent'}>
                              <div className="flex flex-wrap gap-1">
                                <Badge variant={total ? 'info' : 'muted'}>{total} 个绑定</Badge>
                                <ProviderOnlineImpactBadge usage={usage} />
                                {subagents > 0 && (
                                  <Badge variant="muted">{subagents} 个协作角色</Badge>
                                )}
                              </div>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <StatusTag status={Boolean(record.api_key_configured)} trueLabel="已配置" falseLabel="未配置" />
                          </TableCell>
                          <TableCell>
                            <Tooltip content={record.last_check_message || checkMeta.label}>
                              <Badge variant={checkMeta.variant}>{checkMeta.label}</Badge>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <StatusTag status={record.status} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(record.last_checked_at)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="link"
                                disabled={!canManageProviders}
                                onClick={() => openEditor(record)}
                              >
                                编辑
                              </Button>
                              <Button
                                size="sm"
                                variant="link"
                                disabled={!canManageProviders || check.isPending}
                                onClick={() => check.mutate(record.id)}
                              >
                                {check.isPending && <Spinner className="mr-0.5 size-3" />}
                                连通检测
                              </Button>
                              <Confirm
                                title="确定删除该模型通道？"
                                description="仍被 Agent、协作角色、上线版本、存量运行或模型调用记录引用时后端会拒绝删除。"
                                disabled={!canManageProviders}
                                onConfirm={async () => {
                                  try {
                                    await api.deleteLlm(record.id);
                                    toast.success('模型通道已删除');
                                    refresh();
                                  } catch (error) {
                                    toast.error(error instanceof Error ? error.message : '模型通道删除失败');
                                  }
                                }}
                              >
                                <Button size="sm" variant="link" disabled={!canManageProviders} className="text-destructive hover:text-destructive">
                                  <Trash2 size={14} />
                                  删除
                                </Button>
                              </Confirm>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Right: inspector panel */}
        <aside className="flex flex-col gap-4">
          {/* Risk review */}
          <SectionCard
            title="通道审阅"
            description="优先处理会影响上线 Agent 的连接问题。"
          >
            {llms.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                <span>正在加载模型通道状态...</span>
              </div>
            ) : providerRiskItems.length > 0 ? (
              <div className="flex flex-col gap-2">
                {providerRiskItems.map(({ item, tags, usage }) => {
                  const checkMeta = getLlmCheckMeta(item.last_check_status);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      disabled={!canManageProviders}
                      onClick={() => openEditor(item)}
                      title={canManageProviders ? '编辑模型通道' : '需管理员权限'}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{item.name}</span>
                        <Badge variant={checkMeta.variant}>{checkMeta.label}</Badge>
                      </div>
                      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Globe2 size={12} /> {providerTypeLabel(item.provider_type)}</span>
                        <span className="flex items-center gap-1"><Cable size={12} /> {item.default_model || '未设置默认模型'}</span>
                        <span className="flex items-center gap-1"><ListChecks size={12} /> {item.available_models.length} 个可调用模型</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ProviderOnlineImpactBadge usage={usage} />
                        <span className="truncate text-xs text-muted-foreground">
                          {(usage?.publishedNames || []).slice(0, 3).join('、') || '暂未绑定已上线 Agent'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {tags.map((tag) => <Badge key={tag.label} variant={tag.variant}>{tag.label}</Badge>)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-6 text-center">
                <CheckCircle2 size={20} className="text-success" />
                <strong className="text-sm font-medium text-foreground">当前没有待处理通道风险</strong>
                <span className="text-xs text-muted-foreground">启用接入均完成密钥、可调用模型和连通性基础配置。</span>
              </div>
            )}
          </SectionCard>

          {/* Agent dependency summary */}
          <SectionCard
            title="Agent 依赖"
            description="变更模型通道前确认上线版本影响。"
          >
            <div className="flex flex-col gap-3">
              {[
                {
                  label: '可绑定',
                  value: `${providerStats.active}/${providerStats.total}`,
                  detail: `${providerStats.healthy} 个已通过连通检测`,
                  tone: 'default' as const,
                },
                {
                  label: '已上线 Agent',
                  value: publishedProviderBindings,
                  detail: '正在依赖模型通道',
                  tone: publishedProviderBindings ? 'warning' as const : 'default' as const,
                },
                {
                  label: '通道结构',
                  value: `${providerStats.custom}/${providerStats.domestic}/${providerStats.global}`,
                  detail: '自定义 / 国内预设 / 海外官方',
                  tone: 'default' as const,
                },
                {
                  label: '模型范围',
                  value: providerStats.modelCount,
                  detail: '供 Agent 绑定',
                  tone: 'default' as const,
                },
                {
                  label: '密钥配置',
                  value: `${providerStats.configuredKeys}/${providerStats.total}`,
                  detail: providerStats.missingKey ? `${providerStats.missingKey} 个缺少 API Key` : '密钥状态完整',
                  tone: providerStats.missingKey ? 'destructive' as const : 'success' as const,
                },
                {
                  label: '连通检测',
                  value: providerStats.healthy,
                  detail: `${providerStats.failed} 异常 / ${providerStats.unchecked} 未检测`,
                  tone: providerStats.failed ? 'destructive' as const : providerStats.unchecked ? 'warning' as const : 'success' as const,
                },
              ].map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <div className="flex flex-col items-end gap-0.5">
                    <strong className={`text-sm font-semibold ${
                      item.tone === 'destructive' ? 'text-destructive'
                      : item.tone === 'success' ? 'text-success'
                      : item.tone === 'warning' ? 'text-warning'
                      : 'text-foreground'
                    }`}>{item.value}</strong>
                    <em className="text-right text-[11px] not-italic text-muted-foreground">{item.detail}</em>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </aside>
      </div>

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
