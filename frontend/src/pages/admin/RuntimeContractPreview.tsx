import * as React from 'react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Agent, AgentRuntimeManifestEnvelope, RuntimeModelContract, RuntimeResource } from '../../types/domain';
import { shortHash } from './agentStudioModel';

interface RuntimeContractPreviewProps {
  editingAgent: Agent | null;
  manifestEnvelope?: AgentRuntimeManifestEnvelope | null;
  loading?: boolean;
  error?: string;
}

function chipVariant(state: 'active' | 'inactive' | 'missing' | 'neutral' | 'interrupt'): NonNullable<BadgeProps['variant']> {
  switch (state) {
    case 'active':
      return 'success';
    case 'inactive':
      return 'warning';
    case 'missing':
      return 'destructive';
    case 'interrupt':
      return 'info';
    default:
      return 'muted';
  }
}

function renderResourceChips(resources: RuntimeResource[], emptyLabel: string) {
  if (!resources?.length) return <span className="text-xs text-muted-foreground">{emptyLabel}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {resources.map((resource) => {
        const state = resource.status === 'active' ? 'active' : resource.status ? 'inactive' : 'missing';
        return (
          <Badge variant={chipVariant(state)} key={resource.id}>
            {resource.name || resource.id}
          </Badge>
        );
      })}
    </div>
  );
}

function compactText(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function outputModeLabel(mode?: string) {
  return mode === 'json_schema' ? '结构化输出' : '自然语言';
}

function modelContractTitle(contract: RuntimeModelContract) {
  return contract.scope === 'subagent'
    ? contract.subagent || '协作角色'
    : '主流程';
}

function modelContractParams(contract: RuntimeModelContract) {
  const params = [
    contract.temperature !== null && contract.temperature !== undefined ? `temp ${contract.temperature}` : '',
    contract.max_tokens ? `max ${contract.max_tokens}` : '',
    contract.top_p !== null && contract.top_p !== undefined ? `top_p ${contract.top_p}` : '',
  ].filter(Boolean);
  return params.join(' / ') || '默认参数';
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="text-sm font-semibold text-foreground">{value}</strong>
    </div>
  );
}

function ContractSection({
  title,
  meta,
  children,
  className,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-2 rounded-lg border border-border bg-card p-3.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        {meta ? <strong className="text-xs font-semibold text-foreground">{meta}</strong> : null}
      </div>
      {children}
    </section>
  );
}

export function RuntimeContractPreview({
  editingAgent,
  manifestEnvelope,
  loading = false,
  error = '',
}: RuntimeContractPreviewProps) {
  const runtimeManifest = manifestEnvelope?.manifest || null;
  const blockers = [
    ...(runtimeManifest?.missing_tools || []),
    ...(runtimeManifest?.missing_skills || []),
    ...(runtimeManifest?.inactive_tools || []),
    ...(runtimeManifest?.inactive_skills || []),
  ];
  const isReady = Boolean(runtimeManifest && blockers.length === 0);
  const runtimeBackend = runtimeManifest?.backend_type || 'filesystem';
  const filesystemModeLabel = runtimeManifest?.filesystem.mode === 'virtual'
    ? '隔离工作区'
    : runtimeManifest?.filesystem.mode || '隔离工作区';
  const mainInterruptKeys = Object.keys(runtimeManifest?.interrupt_on || {}).filter((key) => runtimeManifest?.interrupt_on[key]);
  const agentName = compactText(runtimeManifest?.agent_name || editingAgent?.name, '未命名服务');
  const agentDescription = compactText(editingAgent?.description, '尚未填写业务边界');
  const routeModel = runtimeManifest?.model || editingAgent?.model || '未设置模型';
  const schemaKeys = Object.keys(runtimeManifest?.output.json_schema?.properties || {}).slice(0, 4);
  const modelContracts = runtimeManifest?.model_contracts || [];

  const sourceBadge = manifestEnvelope?.source === 'preview'
    ? { variant: 'warning' as const, label: '未保存预览' }
    : manifestEnvelope?.source === 'release'
      ? { variant: 'success' as const, label: '上线版本' }
      : { variant: 'info' as const, label: '草稿' };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <span className="text-sm font-semibold text-foreground">后端 Runtime Manifest</span>
        <p className="text-xs text-muted-foreground">展示后端编译后的运行真相；Tools、Skills、Runtime Tools 和权限不在前端复算。</p>
      </div>

      {error && (
        <Alert variant="warning">
          <CircleAlert />
          <div>
            <AlertTitle>运行清单同步失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      )}
      {!runtimeManifest && !error && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
          {loading ? <Spinner /> : <CircleAlert className="size-4 text-muted-foreground" />}
          <strong className="text-sm font-medium text-foreground">{loading ? '正在同步后端 Manifest' : '保存后生成运行清单'}</strong>
          <span className="text-xs text-muted-foreground">新建 Agent 需要先保存草稿，随后 Inspector 会从后端读取运行真相。</span>
        </div>
      )}
      {runtimeManifest && (
        <>
          <div
            className={cn(
              'flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-3.5 py-2.5',
              isReady ? 'border-success/30 bg-success/8' : 'border-warning/30 bg-warning/8',
            )}
          >
            <div className="flex items-center gap-2 text-sm">
              {loading ? <Loader2 className="size-4 animate-spin" /> : isReady ? <CheckCircle2 className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
              <span className="text-muted-foreground">Manifest</span>
              <strong className="font-semibold text-foreground">{shortHash(manifestEnvelope?.manifest_hash)}</strong>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">就绪状态</span>{' '}
              <strong className="font-semibold text-foreground">{isReady ? '可上线' : '未通过'}</strong>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">未通过项</span>{' '}
              <strong className="font-semibold text-foreground">{blockers.length}</strong>
            </div>
            <Badge variant={sourceBadge.variant} className="ml-auto">{sourceBadge.label}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <SummaryItem label="服务标识" value={editingAgent?.slug || '保存后生成'} />
            <SummaryItem label="模型合约" value={modelContracts.length || (routeModel ? 1 : 0)} />
            <SummaryItem label="Runtime Tools" value={runtimeManifest.main_tools.length} />
            <SummaryItem label="协作角色" value={runtimeManifest.subagents.length} />
            <SummaryItem label="人工确认" value={mainInterruptKeys.length} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ContractSection title="服务身份" meta={agentName}>
              <p className="text-sm text-foreground">{agentDescription}</p>
              <dl className="grid gap-1.5 text-xs">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">执行入口</dt><dd className="text-foreground">/v1/responses</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">模型</dt><dd className="text-foreground">{routeModel}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Manifest 来源</dt><dd className="text-foreground">{manifestEnvelope?.source || '-'}</dd></div>
              </dl>
            </ContractSection>

            <ContractSection title="输入契约" meta={runtimeManifest.checkpointing ? '检查点开启' : '检查点关闭'}>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/40 px-2 py-1.5">
                  <strong className="block text-xs font-semibold text-foreground">统一协议</strong>
                  <span className="text-[11px] text-muted-foreground">业务验证、体验台和外部客户端走同一执行入口</span>
                </div>
                <div className="rounded-md bg-muted/40 px-2 py-1.5">
                  <strong className="block text-sm font-semibold text-foreground">{runtimeManifest.memory.length}</strong>
                  <span className="text-[11px] text-muted-foreground">Memory</span>
                </div>
                <div className="rounded-md bg-muted/40 px-2 py-1.5">
                  <strong className="block text-sm font-semibold text-foreground">{runtimeManifest.knowledge.length}</strong>
                  <span className="text-[11px] text-muted-foreground">知识快照</span>
                </div>
              </div>
            </ContractSection>

            <ContractSection title="输出契约" meta={outputModeLabel(runtimeManifest.output.mode)}>
              {runtimeManifest.output.mode === 'json_schema' ? (
                <div className="flex flex-wrap gap-1.5">
                  {schemaKeys.length ? schemaKeys.map((key) => (
                    <Badge variant="success" key={key}>{key}</Badge>
                  )) : <span className="text-xs text-muted-foreground">未声明字段</span>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">输出以可读文本为主，结构化约束由上线验收用例兜底。</p>
              )}
            </ContractSection>

            <ContractSection title="模型运行合约" meta={`${modelContracts.length} 条冻结调用边界`} className="lg:col-span-2">
              <div className="grid gap-2 sm:grid-cols-2">
                {modelContracts.map((contract) => (
                  <article key={`${contract.scope}-${contract.subagent || 'main'}-${contract.llm_config_id}-${contract.model}`} className="space-y-1.5 rounded-md border border-border bg-background p-2.5">
                    <div>
                      <strong className="text-sm font-semibold text-foreground">{modelContractTitle(contract)}</strong>
                      <span className="block text-xs text-muted-foreground">{contract.provider_type || 'unknown'} · {contract.model || '未设置模型'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><label className="block text-muted-foreground">Base URL</label><span className="text-foreground">{contract.base_url || '官方默认'}</span></div>
                      <div><label className="block text-muted-foreground">Headers</label><span className="text-foreground">{Object.keys(contract.default_headers || {}).length}</span></div>
                      <div><label className="block text-muted-foreground">Params</label><span className="text-foreground">{modelContractParams(contract)}</span></div>
                    </div>
                  </article>
                ))}
                {!modelContracts.length && (
                  <div className="flex flex-col gap-1 rounded-md border border-dashed border-border bg-muted/30 p-3 text-center sm:col-span-2">
                    <strong className="text-sm font-medium text-foreground">模型合约未生成</strong>
                    <span className="text-xs text-muted-foreground">需要绑定可用模型通道后，后端 Manifest 才会冻结 provider 调用边界。</span>
                  </div>
                )}
              </div>
            </ContractSection>

            <ContractSection title="Runtime Tools" meta={`${runtimeManifest.main_tools.length} 项`} className="lg:col-span-2">
              {renderResourceChips(runtimeManifest.main_tools, '未生成 Runtime Tools')}
            </ContractSection>

            <ContractSection title="Skills & Memory" meta={`${runtimeManifest.main_skills.length + runtimeManifest.memory.length} 项`} className="lg:col-span-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Skills</label>
                  {renderResourceChips(runtimeManifest.main_skills, '未绑定 Skills')}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Memory</label>
                  {runtimeManifest.memory.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {runtimeManifest.memory.map((item: string) => (
                        <Badge variant="muted" key={item}>{item}</Badge>
                      ))}
                    </div>
                  ) : <span className="text-xs text-muted-foreground">未配置服务记忆</span>}
                </div>
              </div>
            </ContractSection>

            <ContractSection title="协作角色" meta={`${runtimeManifest.subagents.length} 个角色`} className="lg:col-span-2">
              <div className="space-y-2">
                {runtimeManifest.subagents.map((subagent, index) => (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-background p-2.5" key={`${subagent.name || 'subagent'}-${index}`}>
                    <em className="text-xs font-semibold not-italic text-muted-foreground">{String(index + 1).padStart(2, '0')}</em>
                    <div className="min-w-[8rem] flex-1">
                      <strong className="block text-sm font-semibold text-foreground">{subagent.name || `协作角色 ${index + 1}`}</strong>
                      <span className="text-xs text-muted-foreground">{compactText(subagent.description || subagent.system_prompt, '未填写职责边界')}</span>
                    </div>
                    <div className="text-xs"><label className="block text-muted-foreground">模型</label><span className="text-foreground">{subagent.model || '继承主模型'}</span></div>
                    <div className="text-xs"><label className="block text-muted-foreground">Tools</label><span className="text-foreground">{subagent.tools.length}</span></div>
                    <div className="text-xs"><label className="block text-muted-foreground">Skills</label><span className="text-foreground">{subagent.skills.length}</span></div>
                    <div className="text-xs"><label className="block text-muted-foreground">确认</label><span className="text-foreground">{Object.keys(subagent.interrupt_on || {}).filter((key) => subagent.interrupt_on[key]).length}</span></div>
                  </div>
                ))}
                {!runtimeManifest.subagents.length && (
                  <div className="flex flex-col gap-1 rounded-md border border-dashed border-border bg-muted/30 p-3 text-center">
                    <strong className="text-sm font-medium text-foreground">未配置协作角色</strong>
                    <span className="text-xs text-muted-foreground">当前 Agent 仅由主流程执行。</span>
                  </div>
                )}
              </div>
            </ContractSection>

            <ContractSection title="运行策略" meta={runtimeBackend} className="lg:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {[
                  runtimeManifest.checkpointing ? '检查点开启' : '检查点关闭',
                  runtimeManifest.debug ? '记录技术细节' : '不记录技术细节',
                  `服务工作区 ${runtimeManifest.filesystem.enabled === false ? '关闭' : filesystemModeLabel}`,
                  runtimeManifest.filesystem.read_only ? '文件只读' : '允许写入',
                  runtimeManifest.permissions.allow_write ? '路径写入受控' : '无额外写入权限',
                ].map((item) => (
                  <Badge variant="muted" key={item}>{item}</Badge>
                ))}
              </div>
              {runtimeManifest.warnings.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {runtimeManifest.warnings.map((item) => (
                    <Badge variant="info" key={item}>{item}</Badge>
                  ))}
                </div>
              )}
            </ContractSection>

            <ContractSection title="人工确认" meta={mainInterruptKeys.length ? '已启用' : '未启用'} className="lg:col-span-2">
              {mainInterruptKeys.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {mainInterruptKeys.map((item: string) => (
                    <Badge variant="info" key={item}>{item}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">主流程未配置强制确认点，上线前应确认高风险 Tools 已有安全边界。</p>
              )}
            </ContractSection>
          </div>
        </>
      )}
    </div>
  );
}
