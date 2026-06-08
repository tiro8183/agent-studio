import * as React from 'react';
import { TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  Agent,
  AgentRuntimeManifestEnvelope,
  LLMConfig,
} from '../../types/domain';
import { RuntimeContractPreview } from './RuntimeContractPreview';
import {
  StudioInput,
  StudioTextarea,
  StudioNumber,
  StudioSelect,
  StudioMultiSelect,
  StudioTags,
  StudioSwitch,
  useFormWatch,
  useFieldList,
  type Option,
  type StudioFormShim,
} from './studioForm';

function SectionTitle({ title, description, compact }: { title: React.ReactNode; description?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-0.5' : 'space-y-1'}>
      <span className="text-sm font-semibold text-foreground">{title}</span>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

interface ProfilePanelProps {
  form: StudioFormShim;
  llmOptions: Array<{ label: string; value: string; config: LLMConfig }>;
  modelOptions: Option[];
  canEdit: boolean;
}

export function ProfilePanel({ form, canEdit }: ProfilePanelProps) {
  const slug = useFormWatch(form, 'slug');
  const modelRef = slug ? `agent:${slug}` : 'agent:{调用标识}';
  const approvalOptions: Option[] = [
    { value: '可接入', label: '可接入' },
    { value: '需审批', label: '需审批' },
    { value: '暂停接入', label: '暂停接入' },
    { value: '禁止接入', label: '禁止接入' },
  ];
  const samplePrompts = useFieldList<string>(form, ['metadata', 'service_catalog', 'sample_prompts']);
  return (
    <div className="space-y-4">
      <SectionTitle title="Agent 服务画像" description="定义业务场景、目录信息和对外调用边界；执行配置在下方绑定 Model Provider。" />
      <StudioInput form={form} name="name" label="Agent 名称" required disabled={!canEdit} />
      <StudioInput
        form={form}
        name="slug"
        label="调用标识"
        hint="上线后用于外部系统调用，建议使用稳定英文短名。"
        disabled={!canEdit}
        placeholder="business-material-reviewer"
      />
      <StudioTextarea form={form} name="description" label="业务场景" rows={2} disabled={!canEdit} />
      <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3.5">
        <SectionTitle compact title="目录信息" description="这些信息会随上线版本进入服务目录、体验台和外部接入说明。" />
        <div className="grid gap-3 sm:grid-cols-2">
          <StudioInput form={form} name={['metadata', 'service_catalog', 'domain']} label="业务域" disabled={!canEdit} placeholder="例如 风控合规 / 客户经营" />
          <StudioInput form={form} name={['metadata', 'service_catalog', 'department']} label="归属部门" disabled={!canEdit} placeholder="负责人所在部门或团队" />
          <StudioInput form={form} name={['metadata', 'service_catalog', 'owner']} label="维护人" disabled={!canEdit} placeholder="负责人或团队" />
          <StudioInput form={form} name={['metadata', 'service_catalog', 'service_level']} label="支持方式" disabled={!canEdit} placeholder="例如 工作日支持 / 核心流程" />
        </div>
        <StudioInput form={form} name={['metadata', 'service_catalog', 'caller_scope']} label="调用范围" disabled={!canEdit} placeholder="允许调用的组织、系统或角色" />
        <div className="grid gap-3 sm:grid-cols-2">
          <StudioInput form={form} name={['metadata', 'service_catalog', 'integration_policy']} label="接入策略" disabled={!canEdit} placeholder="例如 需业务负责人审批 / 组织内可直接调用" />
          <StudioSelect form={form} name={['metadata', 'service_catalog', 'approval_status']} label="审批状态" disabled={!canEdit} allowClear options={approvalOptions} placeholder="选择外部接入状态" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <StudioInput form={form} name={['metadata', 'service_catalog', 'support_contact']} label="支持联系人" disabled={!canEdit} placeholder="企业微信、邮箱或团队名" />
          <StudioInput form={form} name={['metadata', 'service_catalog', 'data_classification']} label="数据分级" disabled={!canEdit} placeholder="例如 内部 / 敏感 / 受限" />
        </div>
        <StudioInput form={form} name={['metadata', 'service_catalog', 'risk_level']} label="风险等级" disabled={!canEdit} placeholder="例如 常规 / 需复核 / 高风险" />
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">推荐验证任务</span>
            <Button size="sm" variant="outline" disabled={!canEdit || samplePrompts.items.length >= 5} onClick={() => samplePrompts.add('')}>
              添加任务
            </Button>
          </div>
          {samplePrompts.items.map((_, index) => (
            <div className="flex items-end gap-2" key={index}>
              <StudioInput
                form={form}
                name={['metadata', 'service_catalog', 'sample_prompts', index]}
                className="flex-1"
                disabled={!canEdit}
                placeholder="输入一条可复用的业务任务"
              />
              <Button variant="outline" disabled={!canEdit} onClick={() => samplePrompts.remove(index)}>删除</Button>
            </div>
          ))}
        </div>
      </div>
      <details className="rounded-lg border border-border bg-muted/20 p-3.5">
        <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-foreground">
          <TerminalSquare className="size-3.5" />
          <span>API 接入</span>
        </summary>
        <div className="mt-3 space-y-1.5">
          <strong className="text-sm font-semibold text-foreground">标准执行协议</strong>
          <code className="block rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">POST /v1/responses</code>
          <code className="block rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">{`调用标识：${modelRef}`}</code>
          <small className="block text-xs text-muted-foreground">上线后，体验台、外部业务系统和 SDK 会使用同一协议，并写入运行证据。</small>
        </div>
      </details>
    </div>
  );
}

export function ModelContractPanel({ form, llmOptions, modelOptions, canEdit }: ProfilePanelProps) {
  const llmSelectOptions: Option[] = llmOptions.map((item) => ({ value: item.value, label: item.label }));
  return (
    <div className="space-y-4">
      <SectionTitle title="模型调用合约" description="冻结模型通道、默认模型和调用参数；发布后只重新读取密钥引用，不漂移调用配置。" />
      <div className="grid gap-3 sm:grid-cols-2">
        <StudioSelect form={form} name="llm_config_id" label="模型通道" required disabled={!canEdit} options={llmSelectOptions} />
        <StudioSelect form={form} name="model" label="默认模型" required disabled={!canEdit} options={modelOptions} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <StudioNumber form={form} name={['model_override', 'temperature']} label="Temperature" disabled={!canEdit} min={0} max={2} step={0.1} placeholder="继承通道默认值" />
        <StudioNumber form={form} name={['model_override', 'max_tokens']} label="Max tokens" disabled={!canEdit} min={1} step={128} placeholder="继承通道默认值" />
        <StudioNumber form={form} name={['model_override', 'top_p']} label="Top P" disabled={!canEdit} min={0} max={1} step={0.05} placeholder="可选" />
      </div>
    </div>
  );
}

export function InstructionsPanel({ form, canEdit }: { form: StudioFormShim; canEdit: boolean }) {
  return (
    <div className="space-y-4">
      <SectionTitle title="执行标准" description="维护职责、业务边界、Tool 使用方式和交付标准。" />
      <StudioTextarea form={form} name="system_prompt" label="执行说明" required rows={8} disabled={!canEdit} />
    </div>
  );
}

interface CapabilitiesPanelProps {
  form: StudioFormShim;
  editingAgent: Agent | null;
  runtimeManifestEnvelope?: AgentRuntimeManifestEnvelope | null;
  runtimeManifestLoading?: boolean;
  runtimeManifestError?: string;
  toolOptions: Option[];
  skillOptions: Option[];
  canEdit: boolean;
}

export function CapabilitiesPanel({
  form,
  editingAgent,
  runtimeManifestEnvelope,
  runtimeManifestLoading,
  runtimeManifestError,
  toolOptions,
  skillOptions,
  canEdit,
}: CapabilitiesPanelProps) {
  return (
    <div className="space-y-4">
      <SectionTitle title="Runtime 组成" description="组合主流程 direct Tools、Skills 与 Memory；最终 Runtime Tools 只信任后端 Runtime Manifest。" />
      <StudioMultiSelect form={form} name="tools" label="Direct Tools" disabled={!canEdit} options={toolOptions} placeholder="选择这个 Agent 主流程可直接使用的 Tools" />
      <StudioMultiSelect form={form} name="skills" label="Skills" disabled={!canEdit} options={skillOptions} placeholder="选择主流程加载的 Skills" />
      <StudioTags form={form} name="memory" label="Memory" disabled={!canEdit} placeholder="输入服务记忆后回车，例如：默认用中文回复" />
      <RuntimeContractPreview
        editingAgent={editingAgent}
        manifestEnvelope={runtimeManifestEnvelope}
        loading={runtimeManifestLoading}
        error={runtimeManifestError}
      />
    </div>
  );
}

interface SubagentsPanelProps {
  form: StudioFormShim;
  llmOptions: Array<{ label: string; value: string; config: LLMConfig }>;
  toolOptions: Option[];
  skillOptions: Option[];
  modelOptionsForLlm: (llmId?: string | null) => Option[];
  canEdit: boolean;
}

function SubagentRow({
  form,
  index,
  llmOptions,
  toolOptions,
  skillOptions,
  modelOptionsForLlm,
  canEdit,
  onRemove,
}: {
  form: StudioFormShim;
  index: number;
  llmOptions: Option[];
  toolOptions: Option[];
  skillOptions: Option[];
  modelOptionsForLlm: (llmId?: string | null) => Option[];
  canEdit: boolean;
  onRemove: () => void;
}) {
  const subagentLlm = useFormWatch(form, ['subagents', index, 'llm_config_id']);
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <StudioInput form={form} name={['subagents', index, 'name']} label="名称" disabled={!canEdit} placeholder="资料核验员" />
        <StudioInput form={form} name={['subagents', index, 'description']} label="职责描述" disabled={!canEdit} placeholder="负责检索、核对和整理资料" />
      </div>
      <StudioTextarea form={form} name={['subagents', index, 'system_prompt']} label="执行说明" rows={3} disabled={!canEdit} />
      <div className="grid gap-3 sm:grid-cols-2">
        <StudioSelect form={form} name={['subagents', index, 'llm_config_id']} label="模型通道覆盖" disabled={!canEdit} allowClear options={llmOptions} placeholder="默认继承主服务" />
        <StudioSelect form={form} name={['subagents', index, 'model']} label="模型覆盖" disabled={!canEdit} allowClear options={modelOptionsForLlm(subagentLlm)} placeholder="默认继承主模型" />
      </div>
      <StudioMultiSelect form={form} name={['subagents', index, 'tools']} label="Direct Tools" disabled={!canEdit} options={toolOptions} />
      <StudioMultiSelect form={form} name={['subagents', index, 'skills']} label="Skills" disabled={!canEdit} options={skillOptions} />
      <StudioTags form={form} name={['subagents', index, 'memory']} label="Memory" disabled={!canEdit} />
      <div className="grid gap-3 sm:grid-cols-2">
        <StudioSelect
          form={form}
          name={['subagents', index, 'output', 'mode']}
          label="输出模式"
          disabled={!canEdit}
          options={[
            { value: 'text', label: '文本' },
            { value: 'json_schema', label: '结构化输出' },
          ]}
        />
      </div>
      <StudioTextarea
        form={form}
        name={['subagents', index, 'output', 'schema_text']}
        label="角色输出格式"
        rows={4}
        disabled={!canEdit}
        placeholder='{"type":"object","properties":{"summary":{"type":"string"}}}'
      />
      <StudioTags form={form} name={['subagents', index, 'interrupt_tools']} label="需人工确认的 Tools" disabled={!canEdit} placeholder="选择需要人工确认的 Tools" />
      <div className="grid gap-3 sm:grid-cols-2">
        <StudioSwitch form={form} name={['subagents', index, 'permissions', 'allow_write']} label="角色允许写入" disabled={!canEdit} />
        <StudioTags form={form} name={['subagents', index, 'permissions', 'allowed_paths']} label="访问范围" disabled={!canEdit} placeholder="留空继承主服务" />
      </div>
      <Button variant="destructive" disabled={!canEdit} onClick={onRemove}>删除协作角色</Button>
    </div>
  );
}

export function SubagentsPanel({
  form,
  llmOptions,
  toolOptions,
  skillOptions,
  modelOptionsForLlm,
  canEdit,
}: SubagentsPanelProps) {
  const subagents = useFieldList(form, 'subagents');
  const llmSelectOptions: Option[] = llmOptions.map((item) => ({ value: item.value, label: item.label }));
  return (
    <div className="space-y-4">
      <SectionTitle title="Subagents" description="为研究、执行、审核等任务配置可委派的专业角色。" />
      <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">Subagents</span>
          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit}
            title={canEdit ? '添加 Subagent' : '需编辑权限'}
            onClick={() => subagents.add({
              name: '',
              description: '',
              system_prompt: '',
              llm_config_id: null,
              model: null,
              tools: [],
              skills: [],
              memory: [],
              interrupt_on: {},
              permissions: null,
              output: { mode: 'text', json_schema: {}, schema_text: '{}' },
              interrupt_tools: [],
            })}
          >
            添加 Subagent
          </Button>
        </div>
        {subagents.items.map((_, index) => (
          <SubagentRow
            key={index}
            form={form}
            index={index}
            llmOptions={llmSelectOptions}
            toolOptions={toolOptions}
            skillOptions={skillOptions}
            modelOptionsForLlm={modelOptionsForLlm}
            canEdit={canEdit}
            onRemove={() => subagents.remove(index)}
          />
        ))}
      </div>
    </div>
  );
}

// Kept for API parity; renders a circular readiness indicator.
export function ReadinessRing({ percent, size = 96 }: { percent: number; size?: number }) {
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
