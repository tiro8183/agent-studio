import { Button, Form, Input, InputNumber, Select, Space, Switch } from 'antd';
import type { FormInstance } from 'antd';
import { TerminalSquare } from 'lucide-react';
import type {
  Agent,
  AgentRuntimeManifestEnvelope,
  LLMConfig,
} from '../../types/domain';
import { RuntimeContractPreview } from './RuntimeContractPreview';

export function ReadinessRing({ percent, size = 96 }: { percent: number; size?: number }) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const strokeWidth = Math.max(6, Math.round(size * 0.08));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - safePercent / 100);
  const center = size / 2;

  return (
    <div className="readiness-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="readiness-ring-track" cx={center} cy={center} r={radius} strokeWidth={strokeWidth} />
        <circle
          className="readiness-ring-value"
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <strong>{safePercent}%</strong>
    </div>
  );
}

interface ProfilePanelProps {
  llmOptions: Array<{ label: string; value: string; config: LLMConfig }>;
  modelOptions: Array<{ label: string; value: string }>;
  canEdit: boolean;
}

export function ProfilePanel({ llmOptions, modelOptions, canEdit }: ProfilePanelProps) {
  const slug = Form.useWatch('slug');
  const modelRef = slug ? `agent:${slug}` : 'agent:{调用标识}';
  return (
    <>
      <div className="builder-section-title">
        <span>服务身份</span>
        <p>定义服务名称、业务场景和市场信息；执行配置在下方绑定模型通道。</p>
      </div>
      <Form.Item name="name" label="服务名称" rules={[{ required: true }]}>
        <Input disabled={!canEdit} />
      </Form.Item>
      <Form.Item
        name="slug"
        label="调用标识"
        extra="上线后用于外部系统调用，建议使用稳定英文短名。"
        rules={[{ pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: '仅支持小写字母、数字和短横线' }]}
      >
        <Input disabled={!canEdit} placeholder="business-material-reviewer" />
      </Form.Item>
      <Form.Item name="description" label="业务场景">
        <Input.TextArea rows={2} disabled={!canEdit} />
      </Form.Item>
      <div className="studio-directory-fields">
        <div className="builder-section-title compact">
          <span>目录信息</span>
          <p>这些信息会随上线版本进入 Agent 广场和体验台。</p>
        </div>
        <Space.Compact block>
          <Form.Item name={['metadata', 'service_catalog', 'domain']} label="业务域" className="compact-field">
            <Input disabled={!canEdit} placeholder="例如 风控合规 / 客户经营" />
          </Form.Item>
          <Form.Item name={['metadata', 'service_catalog', 'department']} label="归属部门" className="compact-field">
            <Input disabled={!canEdit} placeholder="负责人所在部门或团队" />
          </Form.Item>
        </Space.Compact>
        <Space.Compact block>
          <Form.Item name={['metadata', 'service_catalog', 'owner']} label="维护人" className="compact-field">
            <Input disabled={!canEdit} placeholder="负责人或团队" />
          </Form.Item>
          <Form.Item name={['metadata', 'service_catalog', 'service_level']} label="支持方式" className="compact-field">
            <Input disabled={!canEdit} placeholder="例如 工作日支持 / 核心流程" />
          </Form.Item>
        </Space.Compact>
        <Form.Item name={['metadata', 'service_catalog', 'caller_scope']} label="调用范围">
          <Input disabled={!canEdit} placeholder="允许调用的组织、系统或角色" />
        </Form.Item>
        <Form.List name={['metadata', 'service_catalog', 'sample_prompts']}>
          {(fields, { add, remove }) => (
            <div className="catalog-prompt-list">
              <div className="catalog-prompt-head">
                <span>推荐验证任务</span>
                <Button size="small" disabled={!canEdit || fields.length >= 5} onClick={() => add('')}>
                  添加任务
                </Button>
              </div>
              {fields.map((field) => (
                <Space.Compact block key={field.key}>
                  <Form.Item {...field} className="compact-field" rules={[{ max: 220, message: '体验任务不能超过 220 字' }]}>
                    <Input disabled={!canEdit} placeholder="输入一条可复用的业务任务" />
                  </Form.Item>
                  <Button disabled={!canEdit} onClick={() => remove(field.name)}>删除</Button>
                </Space.Compact>
              ))}
            </div>
          )}
        </Form.List>
      </div>
      <details className="studio-call-contract">
        <summary>
          <TerminalSquare size={15} />
          <span>开发接入</span>
        </summary>
        <div>
          <strong>标准执行入口</strong>
          <code>{`调用标识：${modelRef}`}</code>
          <small>上线后，体验台、外部业务系统和 SDK 会使用同一执行入口。</small>
        </div>
      </details>
    </>
  );
}

export function ModelContractPanel({ llmOptions, modelOptions, canEdit }: ProfilePanelProps) {
  return (
    <>
      <div className="builder-section-title">
        <span>模型合约</span>
        <p>冻结模型通道、默认模型和调用参数；发布后只重新读取密钥引用，不漂移调用配置。</p>
      </div>
      <Space.Compact block>
        <Form.Item name="llm_config_id" label="模型通道" className="compact-field" rules={[{ required: true }]}>
          <Select disabled={!canEdit} options={llmOptions} />
        </Form.Item>
        <Form.Item name="model" label="默认模型" className="compact-field" rules={[{ required: true }]}>
          <Select disabled={!canEdit} showSearch options={modelOptions} />
        </Form.Item>
      </Space.Compact>
      <Space.Compact block>
        <Form.Item name={['model_override', 'temperature']} label="Temperature" className="compact-field">
          <InputNumber disabled={!canEdit} min={0} max={2} step={0.1} placeholder="继承通道默认值" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name={['model_override', 'max_tokens']} label="Max tokens" className="compact-field">
          <InputNumber disabled={!canEdit} min={1} step={128} placeholder="继承通道默认值" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name={['model_override', 'top_p']} label="Top P" className="compact-field">
          <InputNumber disabled={!canEdit} min={0} max={1} step={0.05} placeholder="可选" style={{ width: '100%' }} />
        </Form.Item>
      </Space.Compact>
    </>
  );
}

export function InstructionsPanel({ canEdit }: { canEdit: boolean }) {
  return (
    <>
      <div className="builder-section-title">
        <span>执行标准</span>
        <p>维护职责、业务边界、工具使用方式和交付标准。</p>
      </div>
      <Form.Item name="system_prompt" label="执行说明" rules={[{ required: true }]}>
        <Input.TextArea rows={8} disabled={!canEdit} />
      </Form.Item>
    </>
  );
}

interface CapabilitiesPanelProps {
  editingAgent: Agent | null;
  runtimeManifestEnvelope?: AgentRuntimeManifestEnvelope | null;
  runtimeManifestLoading?: boolean;
  runtimeManifestError?: string;
  toolOptions: Array<{ value: string; label: string }>;
  skillOptions: Array<{ value: string; label: string }>;
  canEdit: boolean;
}

export function CapabilitiesPanel({
  editingAgent,
  runtimeManifestEnvelope,
  runtimeManifestLoading,
  runtimeManifestError,
  toolOptions,
  skillOptions,
  canEdit,
}: CapabilitiesPanelProps) {
  return (
    <>
      <div className="builder-section-title">
        <span>运行编排</span>
        <p>组合主流程可直接使用的工具、能力包和服务记忆。</p>
      </div>
      <Form.Item name="tools" label="可用工具">
        <Select
          disabled={!canEdit}
          mode="multiple"
          options={toolOptions}
          placeholder="选择这个 Agent 可使用的工具"
        />
      </Form.Item>
      <Form.Item name="skills" label="能力包">
        <Select
          disabled={!canEdit}
          mode="multiple"
          options={skillOptions}
          placeholder="选择主流程加载的能力包"
        />
      </Form.Item>
      <Form.Item name="memory" label="服务记忆">
        <Select
          disabled={!canEdit}
          mode="tags"
          tokenSeparators={[',', '，']}
          placeholder="输入服务记忆后回车，例如：默认用中文回复"
        />
      </Form.Item>
      <RuntimeContractPreview
        editingAgent={editingAgent}
        manifestEnvelope={runtimeManifestEnvelope}
        loading={runtimeManifestLoading}
        error={runtimeManifestError}
      />
    </>
  );
}

interface SubagentsPanelProps {
  agentForm: FormInstance;
  llmOptions: Array<{ label: string; value: string; config: LLMConfig }>;
  toolOptions: Array<{ value: string; label: string }>;
  skillOptions: Array<{ value: string; label: string }>;
  modelOptionsForLlm: (llmId?: string | null) => Array<{ label: string; value: string }>;
  canEdit: boolean;
}

export function SubagentsPanel({
  agentForm,
  llmOptions,
  toolOptions,
  skillOptions,
  modelOptionsForLlm,
  canEdit,
}: SubagentsPanelProps) {
  return (
    <>
      <div className="builder-section-title">
        <span>协作角色</span>
        <p>为研究、执行、审核等任务配置可委派的专业角色。</p>
      </div>
      <Form.List name="subagents">
        {(fields, { add, remove }) => (
          <div className="rules-box">
            <div className="rules-title">
              <span>协作角色</span>
              <Button
                size="small"
                disabled={!canEdit}
                title={canEdit ? '添加协作角色' : '需编辑权限'}
                onClick={() => add({
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
                添加协作角色
              </Button>
            </div>
            {fields.map((field) => (
              <div className="subagent-row" key={field.key}>
                <Space.Compact block>
                  <Form.Item name={[field.name, 'name']} label="名称" className="compact-field">
                    <Input disabled={!canEdit} placeholder="资料核验员" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'description']} label="职责描述" className="compact-field">
                    <Input disabled={!canEdit} placeholder="负责检索、核对和整理资料" />
                  </Form.Item>
                </Space.Compact>
                <Form.Item name={[field.name, 'system_prompt']} label="执行说明">
                  <Input.TextArea rows={3} disabled={!canEdit} />
                </Form.Item>
                <Space.Compact block>
                  <Form.Item name={[field.name, 'llm_config_id']} label="模型通道覆盖" className="compact-field">
                    <Select disabled={!canEdit} allowClear options={llmOptions} placeholder="默认继承主服务" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'model']} label="模型覆盖" className="compact-field">
                    <Select
                      disabled={!canEdit}
                      allowClear
                      showSearch
                      options={modelOptionsForLlm(agentForm.getFieldValue(['subagents', field.name, 'llm_config_id']))}
                      placeholder="默认继承主模型"
                    />
                  </Form.Item>
                </Space.Compact>
                <Form.Item name={[field.name, 'tools']} label="可用工具">
                  <Select disabled={!canEdit} mode="multiple" options={toolOptions} />
                </Form.Item>
                <Form.Item name={[field.name, 'skills']} label="可用能力包">
                  <Select disabled={!canEdit} mode="multiple" options={skillOptions} />
                </Form.Item>
                <Form.Item name={[field.name, 'memory']} label="角色偏好">
                  <Select disabled={!canEdit} mode="tags" tokenSeparators={[',', '，']} />
                </Form.Item>
                <Space.Compact block>
                  <Form.Item name={[field.name, 'output', 'mode']} label="输出模式" className="compact-field">
                    <Select disabled={!canEdit} options={[
                      { value: 'text', label: '文本' },
                      { value: 'json_schema', label: '结构化输出' },
                    ]} />
                  </Form.Item>
                </Space.Compact>
                <Form.Item name={[field.name, 'output', 'schema_text']} label="角色输出格式">
                  <Input.TextArea
                    rows={4}
                    disabled={!canEdit}
                    placeholder='{"type":"object","properties":{"summary":{"type":"string"}}}'
                  />
                </Form.Item>
                <Form.Item name={[field.name, 'interrupt_tools']} label="需人工确认的工具">
                  <Select
                    disabled={!canEdit}
                    mode="tags"
                    tokenSeparators={[',', '，']}
                    placeholder="选择需要人工确认的工具"
                  />
                </Form.Item>
                <Space.Compact block>
                  <Form.Item name={[field.name, 'permissions', 'allow_write']} label="角色允许写入" valuePropName="checked" className="compact-field">
                    <Switch disabled={!canEdit} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'permissions', 'allowed_paths']} label="访问范围" className="compact-field">
                    <Select disabled={!canEdit} mode="tags" tokenSeparators={[',', '，']} placeholder="留空继承主服务" />
                  </Form.Item>
                </Space.Compact>
                <Button danger disabled={!canEdit} onClick={() => remove(field.name)}>删除协作角色</Button>
              </div>
            ))}
          </div>
        )}
      </Form.List>
    </>
  );
}
