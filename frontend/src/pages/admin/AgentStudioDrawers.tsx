import * as React from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody } from '@/components/ui/sheet';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AgentPreflight, AgentReleaseSnapshot, AgentRuntimeManifest, AgentRuntimeManifestEnvelope, KnowledgeDocumentDetail, RuntimeModelContract } from '../../types/domain';
import {
  agentStatusMeta,
  preflightGroupMeta,
  preflightGroupOrder,
  renderPreflightEvidence,
  shortHash,
} from './agentStudioModel';
import { renderRuntimeResources } from './renderers';

function ScoreRing({ percent, size = 96 }: { percent: number; size?: number }) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const strokeWidth = Math.max(6, Math.round(size * 0.08));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - safePercent / 100);
  const center = size / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle className="text-muted" cx={center} cy={center} r={radius} strokeWidth={strokeWidth} stroke="currentColor" fill="none" />
        <circle
          className="text-primary transition-all"
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={strokeWidth}
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <strong className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-foreground">{safePercent}%</strong>
    </div>
  );
}

function KvList({ items }: { items: Array<{ label: React.ReactNode; value: React.ReactNode }> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">{item.label}</span>
          <strong className="font-semibold text-foreground">{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function MiniEmpty({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground', className)}>{children}</div>;
}

interface AgentPreflightDrawerProps {
  open: boolean;
  preflight: AgentPreflight | null;
  onClose: () => void;
}

export function AgentPreflightDrawer({ open, preflight, onClose }: AgentPreflightDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[920px]">
        <SheetHeader>
          <SheetTitle>{preflight ? `Preflight · ${preflight.agent_name}` : 'Preflight'}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-5">
          {preflight && (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <ScoreRing percent={preflight.score} />
                <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2', preflight.can_run ? 'border-success/30 bg-success/8' : 'border-warning/30 bg-warning/8')}>
                  {preflight.can_run ? <CheckCircle2 className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
                  <div>
                    <strong className="block text-sm font-semibold text-foreground">{preflight.can_run ? '可验证' : '运行前存在未通过项'}</strong>
                    <span className="text-xs text-muted-foreground">{new Date(preflight.checked_at).toLocaleString()} · {preflight.blockers} 未通过项 / {preflight.warnings} 风险提示</span>
                  </div>
                </div>
                <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2', preflight.can_publish ? 'border-success/30 bg-success/8' : 'border-warning/30 bg-warning/8')}>
                  {preflight.can_publish ? <CheckCircle2 className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
                  <div>
                    <strong className="block text-sm font-semibold text-foreground">{preflight.can_publish ? '可上线' : '存在未通过项'}</strong>
                    <span className="text-xs text-muted-foreground">{agentStatusMeta[preflight.status as keyof typeof agentStatusMeta]?.label || preflight.status}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                {preflightGroupOrder.map((group) => {
                  const checks = preflight.checks.filter((item) => item.group === group);
                  if (!checks.length) return null;
                  return (
                    <section key={group} className="space-y-2">
                      <h3 className="text-sm font-semibold text-foreground">{preflightGroupMeta[group]}</h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {checks.map((check) => {
                          const tone = check.passed
                            ? 'border-success/30 bg-success/6'
                            : check.severity === 'warning'
                              ? 'border-warning/30 bg-warning/6'
                              : check.severity === 'info'
                                ? 'border-info/30 bg-info/6'
                                : 'border-destructive/30 bg-destructive/6';
                          const badge: NonNullable<BadgeProps['variant']> = check.severity === 'blocker' ? 'destructive' : check.severity === 'warning' ? 'warning' : 'muted';
                          return (
                            <article className={cn('space-y-1.5 rounded-lg border p-3', tone)} key={check.key}>
                              <div className="flex items-center gap-2">
                                {check.passed ? <CheckCircle2 className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
                                <strong className="text-sm font-semibold text-foreground">{check.label}</strong>
                                <Badge variant={badge} className="ml-auto">
                                  {check.severity === 'blocker' ? '未通过' : check.severity === 'warning' ? '风险提示' : '信息'}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">{check.detail}</p>
                              {renderPreflightEvidence(check)}
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
              {preflight.runtime_manifest.warnings.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">风险提示</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {preflight.runtime_manifest.warnings.map((item) => <Badge variant="warning" key={item}>{item}</Badge>)}
                  </div>
                </section>
              )}
              <details className="rounded-lg border border-border bg-muted/30 p-3">
                <summary className="cursor-pointer text-sm font-medium text-foreground">技术详情</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{JSON.stringify(preflight, null, 2)}</pre>
              </details>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

interface RuntimeManifestDrawerProps {
  open: boolean;
  manifest: AgentRuntimeManifestEnvelope | null;
  savedDraftManifest?: AgentRuntimeManifestEnvelope | null;
  releases: AgentReleaseSnapshot[];
  currentSpecHash?: string;
  currentManifestHash?: string;
  latestReleaseHash?: string;
  latestReleaseManifestHash?: string;
  onClose: () => void;
}

export function RuntimeManifestDrawer({
  open,
  manifest,
  savedDraftManifest,
  releases,
  currentSpecHash,
  currentManifestHash,
  latestReleaseHash,
  latestReleaseManifestHash,
  onClose,
}: RuntimeManifestDrawerProps) {
  const manifestEnvelope = manifest;
  const runtimeManifest = manifest?.manifest || null;
  const hasReleaseManifest = Boolean(latestReleaseManifestHash);
  const isManifestAligned = Boolean(currentManifestHash && latestReleaseManifestHash && currentManifestHash === latestReleaseManifestHash);
  const latestRelease = releases[0];
  const releaseDiff = runtimeManifest && latestRelease
    ? diffRuntimeManifest(runtimeManifest, latestRelease.runtime_manifest)
    : [];
  const savedDraftDiff = runtimeManifest && savedDraftManifest?.manifest && manifest?.source === 'preview'
    ? diffRuntimeManifest(runtimeManifest, savedDraftManifest.manifest)
    : [];
  const mainModelContract = runtimeManifest?.model_contracts?.find((item) => item.scope === 'main');
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[860px]">
        <SheetHeader>
          <SheetTitle>{runtimeManifest ? `Runtime Manifest · ${runtimeManifest.agent_name}` : 'Runtime Manifest'}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-5">
          {manifestEnvelope && runtimeManifest && (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Runtime Manifest</h3>
                <div className={cn('flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm', isManifestAligned ? 'border-success/30 bg-success/8' : 'border-warning/30 bg-warning/8')}>
                  <span className="text-muted-foreground">{isManifestAligned ? '当前 Manifest 与上线版本一致' : hasReleaseManifest ? '当前 Manifest 与上线版本不一致' : '尚未生成上线版本'}</span>
                  <strong className="font-semibold text-foreground">当前 {shortHash(currentManifestHash || manifestEnvelope.manifest_hash)} · 上线 {shortHash(latestReleaseManifestHash)}</strong>
                </div>
                <KvList
                  items={[
                    { label: 'Manifest Hash', value: shortHash(currentManifestHash || manifestEnvelope.manifest_hash) },
                    { label: '配置版本', value: shortHash(currentSpecHash) },
                    { label: '清单来源', value: manifestEnvelope.source },
                    { label: '模型通道', value: mainModelContract?.provider_type || '-' },
                    { label: '模型', value: runtimeManifest.model },
                    { label: '执行引擎', value: runtimeManifest.engine_mode },
                    { label: '状态存储', value: runtimeManifest.backend_type },
                    { label: '检查点', value: runtimeManifest.checkpointing ? '开启' : '关闭' },
                    { label: '输出', value: runtimeManifest.output.mode },
                  ]}
                />
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Manifest Diff</h3>
                <div className="grid gap-3 lg:grid-cols-2">
                  <ManifestDiffPanel
                    title="未保存改动 vs 已保存草稿"
                    description={manifestEnvelope.source === 'preview' ? '反映当前编辑对运行真相的实时影响。' : '当前没有未保存编辑，草稿 diff 为空。'}
                    emptyText={manifestEnvelope.source === 'preview' ? '未保存编辑没有改变可比较的运行结构。' : '仅在未保存编辑预览时显示。'}
                    diffs={savedDraftDiff}
                  />
                  <ManifestDiffPanel
                    title="当前 Manifest vs 上线版本"
                    description="用于判断这次配置是否改变线上 Tools、权限、后端或知识快照。"
                    emptyText={latestRelease ? '当前 Manifest 与最新上线版本无结构差异。' : '尚未生成上线版本，暂无 diff。'}
                    diffs={releaseDiff}
                  />
                </div>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">上线版本</h3>
                <div className="space-y-2">
                  {releases.map((release) => {
                    const releaseManifest = release.runtime_manifest;
                    const resourceCount = releaseManifest.main_tools.length + releaseManifest.main_skills.length + releaseManifest.subagents.length;
                    const isCurrent = release.manifest_hash === latestReleaseManifestHash;
                    return (
                      <article className={cn('space-y-2 rounded-lg border p-3', isCurrent ? 'border-success/40 bg-success/6' : 'border-border bg-card')} key={release.id}>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <strong className="text-sm font-semibold text-foreground">v{release.version}</strong>
                            <span className="ml-2 text-xs text-muted-foreground">{new Date(release.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
                          </div>
                          <Badge variant={isCurrent ? 'success' : 'muted'}>
                            {isCurrent ? '当前上线版本' : '历史版本'}
                          </Badge>
                        </div>
                        <KvList
                          items={[
                            { label: 'Manifest', value: shortHash(release.manifest_hash) },
                            { label: '配置版本', value: shortHash(release.spec_hash) },
                            { label: '模型通道', value: releaseManifest.model_contracts?.find((item) => item.scope === 'main')?.provider_type || '-' },
                            { label: '模型', value: releaseManifest.model },
                            { label: 'Runtime Resources', value: resourceCount },
                            { label: '业务资料快照', value: `${release.knowledge_snapshot_count} 份` },
                          ]}
                        />
                      </article>
                    );
                  })}
                  {!releases.length && <MiniEmpty>尚未生成上线版本。</MiniEmpty>}
                </div>
              </section>
              {runtimeManifest.warnings.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {runtimeManifest.warnings.map((item) => <Badge variant="warning" key={item}>{item}</Badge>)}
                </div>
              )}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">模型调用快照</h3>
                <div className="space-y-2">
                  {runtimeManifest.model_contracts.map((contract) => (
                    <article key={`${contract.scope}-${contract.subagent || 'main'}-${contract.llm_config_id}-${contract.model}`} className="space-y-2 rounded-lg border border-border bg-card p-3">
                      <div>
                        <strong className="text-sm font-semibold text-foreground">{modelContractTitle(contract)}</strong>
                        <span className="block text-xs text-muted-foreground">{contract.provider_type || 'unknown'} · {contract.model || '未设置模型'}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
                        <div><strong className="block text-foreground">Base URL</strong><span className="text-muted-foreground">{contract.base_url || '官方默认'}</span></div>
                        <div><strong className="block text-foreground">Headers</strong><span className="text-muted-foreground">{Object.keys(contract.default_headers || {}).length}</span></div>
                        <div><strong className="block text-foreground">调用参数</strong><span className="text-muted-foreground">{modelContractParams(contract)}</span></div>
                        <div><strong className="block text-foreground">Secret Ref</strong><span className="text-muted-foreground">{contract.api_key_ref || '-'}</span></div>
                      </div>
                    </article>
                  ))}
                  {!runtimeManifest.model_contracts.length && <MiniEmpty>未生成模型调用快照</MiniEmpty>}
                </div>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">主流程</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="space-y-1.5"><strong className="text-xs font-medium text-foreground">Runtime Tools</strong>{renderRuntimeResources(runtimeManifest.main_tools)}</div>
                  <div className="space-y-1.5"><strong className="text-xs font-medium text-foreground">Skills</strong>{renderRuntimeResources(runtimeManifest.main_skills)}</div>
                  <div className="space-y-1.5"><strong className="text-xs font-medium text-foreground">人工确认</strong><span className="text-sm text-muted-foreground">{Object.keys(runtimeManifest.interrupt_on).join(', ') || '无'}</span></div>
                  <div className="space-y-1.5"><strong className="text-xs font-medium text-foreground">访问边界</strong><span className="text-sm text-muted-foreground">{runtimeManifest.permissions.allow_write ? '可写' : '只读'} · {runtimeManifest.permissions.allowed_paths.join(', ') || '未限制'}</span></div>
                </div>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Subagents</h3>
                <div className="space-y-2">
                  {runtimeManifest.subagents.map((subagent) => (
                    <article key={subagent.name} className="space-y-2 rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <strong className="text-sm font-semibold text-foreground">{subagent.name}</strong>
                          <span className="block text-xs text-muted-foreground">{subagent.description || '未填写职责描述'}</span>
                        </div>
                        <Badge variant="muted">{subagent.model}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="space-y-1.5"><strong className="text-xs font-medium text-foreground">Tools</strong>{renderRuntimeResources(subagent.tools)}</div>
                        <div className="space-y-1.5"><strong className="text-xs font-medium text-foreground">Skills</strong>{renderRuntimeResources(subagent.skills)}</div>
                        <div className="space-y-1.5"><strong className="text-xs font-medium text-foreground">输出</strong><span className="text-sm text-muted-foreground">{subagent.output.mode}</span></div>
                        <div className="space-y-1.5"><strong className="text-xs font-medium text-foreground">访问边界</strong><span className="text-sm text-muted-foreground">{subagent.permissions.allow_write ? '可写' : '只读'}</span></div>
                      </div>
                    </article>
                  ))}
                  {!runtimeManifest.subagents.length && <MiniEmpty>未配置协作角色</MiniEmpty>}
                </div>
              </section>
              {(
                runtimeManifest.missing_tools.length > 0
                || runtimeManifest.missing_skills.length > 0
                || runtimeManifest.inactive_tools.length > 0
                || runtimeManifest.inactive_skills.length > 0
              ) && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">依赖未通过项</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {runtimeManifest.missing_tools.map((item) => <Badge variant="destructive" key={`tool-${item}`}>缺失 Tool：{item}</Badge>)}
                    {runtimeManifest.missing_skills.map((item) => <Badge variant="destructive" key={`skill-${item}`}>缺失 Skill：{item}</Badge>)}
                    {runtimeManifest.inactive_tools.map((item) => <Badge variant="warning" key={`inactive-tool-${item}`}>未启用 Tool：{item}</Badge>)}
                    {runtimeManifest.inactive_skills.map((item) => <Badge variant="warning" key={`inactive-skill-${item}`}>未启用 Skill：{item}</Badge>)}
                  </div>
                </section>
              )}
              <details className="rounded-lg border border-border bg-muted/30 p-3">
                <summary className="cursor-pointer text-sm font-medium text-foreground">技术详情</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{JSON.stringify(manifestEnvelope, null, 2)}</pre>
              </details>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function ManifestDiffPanel({
  title,
  description,
  emptyText,
  diffs,
}: {
  title: string;
  description: string;
  emptyText: string;
  diffs: ManifestDiffItem[];
}) {
  return (
    <article className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="space-y-0.5">
        <strong className="text-sm font-semibold text-foreground">{title}</strong>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </div>
      {diffs.length ? (
        <div className="space-y-1.5">
          {diffs.map((item) => {
            const variant: NonNullable<BadgeProps['variant']> = item.type === 'added' ? 'success' : item.type === 'removed' ? 'destructive' : 'warning';
            return (
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs" key={`${title}-${item.field}-${item.value}`}>
                <span className="text-muted-foreground">{item.label}</span>
                <strong className="min-w-0 flex-1 truncate font-medium text-foreground">{item.value}</strong>
                <Badge variant={variant}>{item.type === 'added' ? '新增' : item.type === 'removed' ? '移除' : '变更'}</Badge>
              </div>
            );
          })}
        </div>
      ) : (
        <MiniEmpty>{emptyText}</MiniEmpty>
      )}
    </article>
  );
}

type ManifestDiffItem = {
  field: string;
  label: string;
  value: string;
  type: 'added' | 'removed' | 'changed';
};

function diffRuntimeManifest(current: AgentRuntimeManifest, release: AgentRuntimeManifest): ManifestDiffItem[] {
  const diffs: ManifestDiffItem[] = [];
  pushScalarDiff(diffs, 'model', '模型', current.model, release.model);
  pushScalarDiff(diffs, 'backend', '状态后端', current.backend_type, release.backend_type);
  pushScalarDiff(diffs, 'output', '输出模式', current.output.mode, release.output.mode);
  pushSetDiff(diffs, 'model_contracts', '模型调用快照', modelContractKeys(current.model_contracts), modelContractKeys(release.model_contracts));
  pushSetDiff(diffs, 'main_tools', 'Runtime Tools', ids(current.main_tools), ids(release.main_tools));
  pushSetDiff(diffs, 'main_skills', 'Skills', ids(current.main_skills), ids(release.main_skills));
  pushSetDiff(diffs, 'subagents', 'Subagents', current.subagents.map((item) => item.name), release.subagents.map((item) => item.name));
  pushSetDiff(diffs, 'knowledge', '业务资料', current.knowledge.map((item) => `${item.file_name}:${item.content_hash.slice(0, 12)}`), release.knowledge.map((item) => `${item.file_name}:${item.content_hash.slice(0, 12)}`));
  return diffs.slice(0, 16);
}

function ids(resources: Array<{ id: string }>) {
  return resources.map((item) => item.id);
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

function modelContractKeys(contracts: RuntimeModelContract[] = []) {
  return contracts.map((contract) => [
    contract.scope,
    contract.subagent || '',
    contract.llm_config_id,
    contract.provider_type,
    contract.base_url || '',
    contract.model,
    Object.keys(contract.default_headers || {}).sort().join('|'),
    contract.temperature ?? '',
    contract.max_tokens ?? '',
    contract.top_p ?? '',
    contract.api_key_ref || '',
  ].join(':'));
}

function pushScalarDiff(diffs: ManifestDiffItem[], field: string, label: string, current: string, release: string) {
  if (current === release) return;
  diffs.push({ field, label, value: `${release || '-'} -> ${current || '-'}`, type: 'changed' });
}

function pushSetDiff(diffs: ManifestDiffItem[], field: string, label: string, current: string[], release: string[]) {
  const currentSet = new Set(current.filter(Boolean));
  const releaseSet = new Set(release.filter(Boolean));
  for (const item of currentSet) {
    if (!releaseSet.has(item)) diffs.push({ field, label, value: item, type: 'added' });
  }
  for (const item of releaseSet) {
    if (!currentSet.has(item)) diffs.push({ field, label, value: item, type: 'removed' });
  }
}

interface KnowledgePreviewDrawerProps {
  document: KnowledgeDocumentDetail | null;
  onClose: () => void;
}

export function KnowledgePreviewDrawer({ document, onClose }: KnowledgePreviewDrawerProps) {
  return (
    <Sheet open={Boolean(document)} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[720px]">
        <SheetHeader>
          <SheetTitle>{document?.file_name || '业务资料'}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          {document && (
            <>
              <KvList
                items={[
                  { label: '大小', value: `${Math.ceil(document.size / 1024)} KB` },
                  { label: '字符数', value: document.char_count },
                  { label: '片段数', value: document.chunk_count },
                  { label: '状态', value: document.status },
                ]}
              />
              {document.chunks?.length > 0 && (
                <div className="space-y-2">
                  {document.chunks.map((chunk) => (
                    <div className="space-y-1 rounded-lg border border-border bg-card p-3" key={chunk.id}>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>#{chunk.ordinal + 1}</span>
                        <span>{chunk.char_count} 字符</span>
                        {chunk.content_hash && <span>{chunk.content_hash.slice(0, 12)}</span>}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm text-foreground">{chunk.text}</p>
                    </div>
                  ))}
                </div>
              )}
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">{document.content || document.preview || '暂无可读内容'}</pre>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
