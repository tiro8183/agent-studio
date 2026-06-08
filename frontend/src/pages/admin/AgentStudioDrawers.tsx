import { Drawer, Progress, Space, Tag } from 'antd';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import type { AgentPreflight, AgentReleaseSnapshot, AgentRuntimeManifest, AgentRuntimeManifestEnvelope, KnowledgeDocumentDetail, RuntimeModelContract } from '../../types/domain';
import {
  agentStatusMeta,
  preflightGroupMeta,
  preflightGroupOrder,
  renderPreflightEvidence,
  shortHash,
} from './agentStudioModel';
import { renderRuntimeResources } from './renderers';

interface AgentPreflightDrawerProps {
  open: boolean;
  preflight: AgentPreflight | null;
  onClose: () => void;
}

export function AgentPreflightDrawer({ open, preflight, onClose }: AgentPreflightDrawerProps) {
  return (
    <Drawer
      title={preflight ? `Preflight · ${preflight.agent_name}` : 'Preflight'}
      width={920}
      open={open}
      onClose={onClose}
    >
      {preflight && (
        <div className="agent-preflight">
          <div className="preflight-summary">
            <Progress type="circle" percent={preflight.score} size={96} />
            <div className={preflight.can_run ? 'preflight-state passed' : 'preflight-state'}>
              {preflight.can_run ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
              <div>
                <strong>{preflight.can_run ? '可验证' : '运行前存在未通过项'}</strong>
                <span>{new Date(preflight.checked_at).toLocaleString()} · {preflight.blockers} 未通过项 / {preflight.warnings} 风险提示</span>
              </div>
            </div>
            <div className={preflight.can_publish ? 'preflight-state passed' : 'preflight-state'}>
              {preflight.can_publish ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
              <div>
                <strong>{preflight.can_publish ? '可上线' : '存在未通过项'}</strong>
                <span>{agentStatusMeta[preflight.status as keyof typeof agentStatusMeta]?.label || preflight.status}</span>
              </div>
            </div>
          </div>
          <div className="preflight-groups">
            {preflightGroupOrder.map((group) => {
              const checks = preflight.checks.filter((item) => item.group === group);
              if (!checks.length) return null;
              return (
                <section key={group}>
                  <h3>{preflightGroupMeta[group]}</h3>
                  <div className="preflight-check-grid">
                    {checks.map((check) => (
                      <article
                        className={[
                          'preflight-check',
                          check.passed ? 'passed' : '',
                          !check.passed && check.severity === 'warning' ? 'warning' : '',
                          !check.passed && check.severity === 'info' ? 'info' : '',
                        ].filter(Boolean).join(' ')}
                        key={check.key}
                      >
                        <div>
                          {check.passed ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
                          <strong>{check.label}</strong>
                          <Tag color={check.severity === 'blocker' ? 'error' : check.severity === 'warning' ? 'warning' : 'default'}>
                            {check.severity === 'blocker' ? '未通过' : check.severity === 'warning' ? '风险提示' : '信息'}
                          </Tag>
                        </div>
                        <p>{check.detail}</p>
                        {renderPreflightEvidence(check)}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          {preflight.runtime_manifest.warnings.length > 0 && (
            <section>
              <h3>风险提示</h3>
              <div className="manifest-warnings">
                {preflight.runtime_manifest.warnings.map((item) => <Tag color="warning" key={item}>{item}</Tag>)}
              </div>
            </section>
          )}
          <details className="studio-technical-details">
            <summary>技术详情</summary>
            <pre>{JSON.stringify(preflight, null, 2)}</pre>
          </details>
        </div>
      )}
    </Drawer>
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
  const hasCurrentSpec = Boolean(currentSpecHash);
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
    <Drawer
      title={runtimeManifest ? `Runtime Manifest · ${runtimeManifest.agent_name}` : 'Runtime Manifest'}
      width={860}
      open={open}
      onClose={onClose}
    >
      {manifestEnvelope && runtimeManifest && (
        <div className="runtime-manifest">
          <section>
            <h3>Runtime Manifest</h3>
            <div className={isManifestAligned ? 'release-compare-note aligned' : 'release-compare-note pending'}>
              <span>{isManifestAligned ? '当前 Manifest 与上线版本一致' : hasReleaseManifest ? '当前 Manifest 与上线版本不一致' : '尚未生成上线版本'}</span>
              <strong>当前 {shortHash(currentManifestHash || manifestEnvelope.manifest_hash)} · 上线 {shortHash(latestReleaseManifestHash)}</strong>
            </div>
            <div className="kv-list">
              <div><span>Manifest Hash</span><strong>{shortHash(currentManifestHash || manifestEnvelope.manifest_hash)}</strong></div>
              <div><span>配置版本</span><strong>{shortHash(currentSpecHash)}</strong></div>
              <div><span>清单来源</span><strong>{manifestEnvelope.source}</strong></div>
              <div><span>模型通道</span><strong>{mainModelContract?.provider_type || '-'}</strong></div>
              <div><span>模型</span><strong>{runtimeManifest.model}</strong></div>
              <div><span>执行引擎</span><strong>{runtimeManifest.engine_mode}</strong></div>
              <div><span>状态存储</span><strong>{runtimeManifest.backend_type}</strong></div>
              <div><span>检查点</span><strong>{runtimeManifest.checkpointing ? '开启' : '关闭'}</strong></div>
              <div><span>输出</span><strong>{runtimeManifest.output.mode}</strong></div>
            </div>
          </section>
          <section>
            <h3>Manifest Diff</h3>
            <div className="manifest-diff-panels">
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
          <section>
            <h3>上线版本</h3>
            <div className="release-record-list">
              {releases.map((release) => {
                const releaseManifest = release.runtime_manifest;
                const resourceCount = releaseManifest.main_tools.length + releaseManifest.main_skills.length + releaseManifest.subagents.length;
                return (
                  <article className={release.manifest_hash === latestReleaseManifestHash ? 'current' : ''} key={release.id}>
                    <div className="release-record-head">
                      <div>
                        <strong>v{release.version}</strong>
                        <span>{new Date(release.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
                      </div>
                      <Tag color={release.manifest_hash === latestReleaseManifestHash ? 'success' : 'default'}>
                        {release.manifest_hash === latestReleaseManifestHash ? '当前上线版本' : '历史版本'}
                      </Tag>
                    </div>
                    <div className="release-record-meta">
                      <div><span>Manifest</span><strong>{shortHash(release.manifest_hash)}</strong></div>
                      <div><span>配置版本</span><strong>{shortHash(release.spec_hash)}</strong></div>
                      <div><span>模型通道</span><strong>{releaseManifest.model_contracts?.find((item) => item.scope === 'main')?.provider_type || '-'}</strong></div>
                      <div><span>模型</span><strong>{releaseManifest.model}</strong></div>
                      <div><span>Runtime Resources</span><strong>{resourceCount}</strong></div>
                      <div><span>业务资料快照</span><strong>{release.knowledge_snapshot_count} 份</strong></div>
                    </div>
                  </article>
                );
              })}
              {!releases.length && <div className="mini-empty compact">尚未生成上线版本。</div>}
            </div>
          </section>
          {runtimeManifest.warnings.length > 0 && (
            <div className="manifest-warnings">
              {runtimeManifest.warnings.map((item) => <Tag color="warning" key={item}>{item}</Tag>)}
            </div>
          )}
          <section>
            <h3>模型调用快照</h3>
            <div className="manifest-model-contracts">
              {runtimeManifest.model_contracts.map((contract) => (
                <article key={`${contract.scope}-${contract.subagent || 'main'}-${contract.llm_config_id}-${contract.model}`}>
                  <div>
                    <strong>{modelContractTitle(contract)}</strong>
                    <span>{contract.provider_type || 'unknown'} · {contract.model || '未设置模型'}</span>
                  </div>
                  <div className="manifest-section-grid">
                    <div><strong>Base URL</strong><span>{contract.base_url || '官方默认'}</span></div>
                    <div><strong>Headers</strong><span>{Object.keys(contract.default_headers || {}).length}</span></div>
                    <div><strong>调用参数</strong><span>{modelContractParams(contract)}</span></div>
                    <div><strong>Secret Ref</strong><span>{contract.api_key_ref || '-'}</span></div>
                  </div>
                </article>
              ))}
              {!runtimeManifest.model_contracts.length && <div className="mini-empty">未生成模型调用快照</div>}
            </div>
          </section>
          <section>
            <h3>主流程</h3>
            <div className="manifest-section-grid">
              <div>
                <strong>Runtime Tools</strong>
                {renderRuntimeResources(runtimeManifest.main_tools)}
              </div>
              <div>
                <strong>Skills</strong>
                {renderRuntimeResources(runtimeManifest.main_skills)}
              </div>
              <div>
                <strong>人工确认</strong>
                <span>{Object.keys(runtimeManifest.interrupt_on).join(', ') || '无'}</span>
              </div>
              <div>
                <strong>访问边界</strong>
                <span>{runtimeManifest.permissions.allow_write ? '可写' : '只读'} · {runtimeManifest.permissions.allowed_paths.join(', ') || '未限制'}</span>
              </div>
            </div>
          </section>
          <section>
            <h3>Subagents</h3>
            <div className="manifest-subagents">
              {runtimeManifest.subagents.map((subagent) => (
                <article key={subagent.name}>
                  <div>
                    <strong>{subagent.name}</strong>
                    <span>{subagent.description || '未填写职责描述'}</span>
                  </div>
                  <Tag>{subagent.model}</Tag>
                  <div className="manifest-section-grid">
                    <div><strong>Tools</strong>{renderRuntimeResources(subagent.tools)}</div>
                    <div><strong>Skills</strong>{renderRuntimeResources(subagent.skills)}</div>
                    <div><strong>输出</strong><span>{subagent.output.mode}</span></div>
                    <div><strong>访问边界</strong><span>{subagent.permissions.allow_write ? '可写' : '只读'}</span></div>
                  </div>
                </article>
              ))}
              {!runtimeManifest.subagents.length && <div className="mini-empty">未配置协作角色</div>}
            </div>
          </section>
          {(
            runtimeManifest.missing_tools.length > 0
            || runtimeManifest.missing_skills.length > 0
            || runtimeManifest.inactive_tools.length > 0
            || runtimeManifest.inactive_skills.length > 0
          ) && (
            <section>
              <h3>依赖未通过项</h3>
              <Space wrap>
                {runtimeManifest.missing_tools.map((item) => <Tag color="error" key={`tool-${item}`}>缺失 Tool：{item}</Tag>)}
                {runtimeManifest.missing_skills.map((item) => <Tag color="error" key={`skill-${item}`}>缺失 Skill：{item}</Tag>)}
                {runtimeManifest.inactive_tools.map((item) => <Tag color="warning" key={`inactive-tool-${item}`}>未启用 Tool：{item}</Tag>)}
                {runtimeManifest.inactive_skills.map((item) => <Tag color="warning" key={`inactive-skill-${item}`}>未启用 Skill：{item}</Tag>)}
              </Space>
            </section>
          )}
          <details className="studio-technical-details">
            <summary>技术详情</summary>
            <pre>{JSON.stringify(manifestEnvelope, null, 2)}</pre>
          </details>
        </div>
      )}
    </Drawer>
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
    <article className="manifest-diff-panel">
      <div className="manifest-diff-panel-head">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {diffs.length ? (
        <div className="manifest-diff-grid">
          {diffs.map((item) => (
            <article className={item.type} key={`${title}-${item.field}-${item.value}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <em>{item.type === 'added' ? '新增' : item.type === 'removed' ? '移除' : '变更'}</em>
            </article>
          ))}
        </div>
      ) : (
        <div className="mini-empty compact">{emptyText}</div>
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
    <Drawer
      title={document?.file_name || '业务资料'}
      width={720}
      open={Boolean(document)}
      onClose={onClose}
    >
      {document && (
        <div className="knowledge-detail">
          <div className="kv-list">
            <div><span>大小</span><strong>{Math.ceil(document.size / 1024)} KB</strong></div>
            <div><span>字符数</span><strong>{document.char_count}</strong></div>
            <div><span>片段数</span><strong>{document.chunk_count}</strong></div>
            <div><span>状态</span><strong>{document.status}</strong></div>
          </div>
          {document.chunks?.length > 0 && (
            <div className="knowledge-chunk-list">
              {document.chunks.map((chunk) => (
                <div className="knowledge-chunk-item" key={chunk.id}>
                  <div className="knowledge-chunk-meta">
                    <span>#{chunk.ordinal + 1}</span>
                    <span>{chunk.char_count} 字符</span>
                    {chunk.content_hash && <span>{chunk.content_hash.slice(0, 12)}</span>}
                  </div>
                  <p className="knowledge-chunk-text">{chunk.text}</p>
                </div>
              ))}
            </div>
          )}
          <pre>{document.content || document.preview || '暂无可读内容'}</pre>
        </div>
      )}
    </Drawer>
  );
}
