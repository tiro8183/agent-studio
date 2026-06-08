import { Alert, Spin, Tag } from 'antd';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import type { Agent, AgentRuntimeManifestEnvelope, RuntimeModelContract, RuntimeResource } from '../../types/domain';
import { shortHash } from './agentStudioModel';

interface RuntimeContractPreviewProps {
  editingAgent: Agent | null;
  manifestEnvelope?: AgentRuntimeManifestEnvelope | null;
  loading?: boolean;
  error?: string;
}

function renderResourceChips(resources: RuntimeResource[], emptyLabel: string) {
  if (!resources?.length) return <span className="contract-empty">{emptyLabel}</span>;
  return (
    <div className="contract-chip-list">
      {resources.map((resource) => {
        const state = resource.status === 'active' ? 'active' : resource.status ? 'inactive' : 'missing';
        return (
          <span className={`contract-chip ${state}`} key={resource.id}>
            {resource.name || resource.id}
          </span>
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

  return (
    <div className="runtime-contract-preview">
      <div className="builder-section-title">
        <span>后端 Runtime Manifest</span>
        <p>展示后端编译后的运行真相；工具、能力包和权限不在前端复算。</p>
      </div>

      {error && (
        <Alert
          showIcon
          type="warning"
          message="运行清单同步失败"
          description={error}
        />
      )}
      {!runtimeManifest && !error && (
        <div className="contract-empty-state">
          {loading ? <Spin size="small" /> : <CircleAlert size={15} />}
          <strong>{loading ? '正在同步后端 Manifest' : '保存后生成运行清单'}</strong>
          <span>新建 Agent 需要先保存草稿，随后 Inspector 会从后端读取运行真相。</span>
        </div>
      )}
      {runtimeManifest && (
        <>
      <div className={`runtime-truth-strip ${isReady ? 'ready' : 'blocked'}`}>
        <div>
          {loading ? <Loader2 size={15} className="spin-icon" /> : isReady ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
          <span>Manifest</span>
          <strong>{shortHash(manifestEnvelope?.manifest_hash)}</strong>
        </div>
        <div>
          <span>Readiness</span>
          <strong>{isReady ? 'ready' : 'blocked'}</strong>
        </div>
        <div>
          <span>Blockers</span>
          <strong>{blockers.length}</strong>
        </div>
        <Tag color={manifestEnvelope?.source === 'preview' ? 'gold' : manifestEnvelope?.source === 'release' ? 'green' : 'blue'}>
          {manifestEnvelope?.source === 'preview' ? '未保存预览' : manifestEnvelope?.source === 'release' ? '上线版本' : '草稿'}
        </Tag>
      </div>

      <div className="contract-summary-grid">
        <div>
          <span>服务标识</span>
          <strong>{editingAgent?.slug || '保存后生成'}</strong>
        </div>
        <div>
          <span>模型合约</span>
          <strong>{modelContracts.length || (routeModel ? 1 : 0)}</strong>
        </div>
        <div>
          <span>工具</span>
          <strong>{runtimeManifest.main_tools.length}</strong>
        </div>
        <div>
          <span>协作角色</span>
          <strong>{runtimeManifest.subagents.length}</strong>
        </div>
        <div>
          <span>人工确认</span>
          <strong>{mainInterruptKeys.length}</strong>
        </div>
      </div>

      <div className="contract-body-grid">
        <section className="contract-section identity">
          <div className="contract-section-head">
            <span>服务身份</span>
            <strong>{agentName}</strong>
          </div>
          <p>{agentDescription}</p>
          <dl className="contract-kv-list">
            <div>
              <dt>执行入口</dt>
              <dd>/v1/responses</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{routeModel}</dd>
            </div>
            <div>
              <dt>Manifest 来源</dt>
              <dd>{manifestEnvelope?.source || '-'}</dd>
            </div>
          </dl>
        </section>

        <section className="contract-section">
          <div className="contract-section-head">
            <span>输入契约</span>
            <strong>{runtimeManifest.checkpointing ? '检查点开启' : '检查点关闭'}</strong>
          </div>
          <div className="contract-facts">
            <div>
              <strong>统一协议</strong>
              <span>业务验证、体验台和外部客户端走同一执行入口</span>
            </div>
            <div>
              <strong>{runtimeManifest.memory.length}</strong>
              <span>服务记忆</span>
            </div>
            <div>
              <strong>{runtimeManifest.knowledge.length}</strong>
              <span>知识快照</span>
            </div>
          </div>
        </section>

        <section className="contract-section">
          <div className="contract-section-head">
            <span>输出契约</span>
            <strong>{outputModeLabel(runtimeManifest.output.mode)}</strong>
          </div>
          {runtimeManifest.output.mode === 'json_schema' ? (
            <div className="contract-chip-list">
              {schemaKeys.length ? schemaKeys.map((key) => (
                <span className="contract-chip active" key={key}>{key}</span>
              )) : <span className="contract-empty">未声明字段</span>}
            </div>
          ) : (
            <p>输出以可读文本为主，结构化约束由上线验收用例兜底。</p>
          )}
        </section>

        <section className="contract-section wide">
          <div className="contract-section-head">
            <span>模型运行合约</span>
            <strong>{modelContracts.length} 条冻结调用边界</strong>
          </div>
          <div className="contract-model-list">
            {modelContracts.map((contract) => (
              <article key={`${contract.scope}-${contract.subagent || 'main'}-${contract.llm_config_id}-${contract.model}`}>
                <div>
                  <strong>{modelContractTitle(contract)}</strong>
                  <span>{contract.provider_type || 'unknown'} · {contract.model || '未设置模型'}</span>
                </div>
                <div>
                  <label>Base URL</label>
                  <span>{contract.base_url || '官方默认'}</span>
                </div>
                <div>
                  <label>Headers</label>
                  <span>{Object.keys(contract.default_headers || {}).length}</span>
                </div>
                <div>
                  <label>Params</label>
                  <span>{modelContractParams(contract)}</span>
                </div>
              </article>
            ))}
            {!modelContracts.length && (
              <div className="contract-empty-state">
                <strong>模型合约未生成</strong>
                <span>需要绑定可用模型通道后，后端 Manifest 才会冻结 provider 调用边界。</span>
              </div>
            )}
          </div>
        </section>

        <section className="contract-section wide">
          <div className="contract-section-head">
            <span>允许工具</span>
            <strong>{runtimeManifest.main_tools.length} 项</strong>
          </div>
          {renderResourceChips(runtimeManifest.main_tools, '未绑定工具')}
        </section>

        <section className="contract-section wide">
          <div className="contract-section-head">
            <span>能力包与服务记忆</span>
            <strong>{runtimeManifest.main_skills.length + runtimeManifest.memory.length} 项</strong>
          </div>
          <div className="contract-resource-columns">
            <div>
              <label>能力包</label>
              {renderResourceChips(runtimeManifest.main_skills, '未绑定能力包')}
            </div>
            <div>
              <label>服务记忆</label>
              {runtimeManifest.memory.length ? (
                <div className="contract-chip-list">
                  {runtimeManifest.memory.map((item: string) => (
                    <span className="contract-chip neutral" key={item}>{item}</span>
                  ))}
                </div>
              ) : <span className="contract-empty">未配置服务记忆</span>}
            </div>
          </div>
        </section>

        <section className="contract-section wide">
          <div className="contract-section-head">
            <span>协作角色</span>
            <strong>{runtimeManifest.subagents.length} 个角色</strong>
          </div>
          <div className="contract-role-list">
            {runtimeManifest.subagents.map((subagent, index) => (
                <div className="contract-role-row" key={`${subagent.name || 'subagent'}-${index}`}>
                  <em>{String(index + 1).padStart(2, '0')}</em>
                  <div>
                    <strong>{subagent.name || `协作角色 ${index + 1}`}</strong>
                    <span>{compactText(subagent.description || subagent.system_prompt, '未填写职责边界')}</span>
                  </div>
                  <div>
                    <label>模型</label>
                    <span>{subagent.model || '继承主模型'}</span>
                  </div>
                  <div>
                    <label>工具</label>
                    <span>{subagent.tools.length}</span>
                  </div>
                  <div>
                    <label>能力包</label>
                    <span>{subagent.skills.length}</span>
                  </div>
                  <div>
                    <label>确认</label>
                    <span>{Object.keys(subagent.interrupt_on || {}).filter((key) => subagent.interrupt_on[key]).length}</span>
                  </div>
                </div>
            ))}
            {!runtimeManifest.subagents.length && (
              <div className="contract-empty-state">
                <strong>未配置协作角色</strong>
                <span>当前 Agent 仅由主流程执行。</span>
              </div>
            )}
          </div>
        </section>

        <section className="contract-section wide">
          <div className="contract-section-head">
            <span>运行策略</span>
            <strong>{runtimeBackend}</strong>
          </div>
          <div className="contract-policy-line">
            <span>{runtimeManifest.checkpointing ? '检查点开启' : '检查点关闭'}</span>
            <span>{runtimeManifest.debug ? '记录技术细节' : '不记录技术细节'}</span>
            <span>服务工作区 {runtimeManifest.filesystem.enabled === false ? '关闭' : filesystemModeLabel}</span>
            <span>{runtimeManifest.filesystem.read_only ? '文件只读' : '允许写入'}</span>
            <span>{runtimeManifest.permissions.allow_write ? '路径写入受控' : '无额外写入权限'}</span>
          </div>
          {runtimeManifest.warnings.length > 0 && (
            <div className="contract-chip-list">
              {runtimeManifest.warnings.map((item) => (
                <span className="contract-chip interrupt" key={item}>{item}</span>
              ))}
            </div>
          )}
        </section>

        <section className="contract-section wide">
          <div className="contract-section-head">
            <span>人工确认</span>
            <strong>{mainInterruptKeys.length ? '已启用' : '未启用'}</strong>
          </div>
          {mainInterruptKeys.length ? (
            <div className="contract-chip-list">
              {mainInterruptKeys.map((item: string) => (
                <span className="contract-chip interrupt" key={item}>{item}</span>
              ))}
            </div>
          ) : (
            <p>主流程未配置强制确认点，上线前应确认高风险工具已有安全边界。</p>
          )}
        </section>
      </div>
        </>
      )}
    </div>
  );
}
