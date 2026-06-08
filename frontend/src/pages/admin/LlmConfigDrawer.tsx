import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Collapse, Drawer, Form, Input, InputNumber, Select, Space, Switch } from 'antd';
import {
  officialProviderAllowsEmptyBaseUrl,
  providerPresets,
  providerRegion,
  type ProviderRegion,
} from '../../services/providerCatalog';
import type { LLMConfig } from '../../types/domain';

const defaultLlm: Partial<LLMConfig> = {
  name: '自定义厂商通道',
  provider_type: 'custom',
  api_key: '',
  base_url: '',
  available_models: [{
    name: '',
    is_reasoning_model: false,
  }],
  default_model: '',
  temperature: 0.7,
  max_tokens: 4096,
  extra_headers: {},
  status: 'active',
};

const providerTypePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const sourceModeCopy: Record<ProviderRegion, { title: string; description: string; detail: string }> = {
  domestic: {
    title: '国内预设',
    description: '常用国内模型服务',
    detail: '百炼、DeepSeek、火山方舟、智谱、千帆等',
  },
  custom: {
    title: '自定义接入',
    description: '任意厂商、内部网关或聚合服务',
    detail: '填写厂商标识、Base URL 和模型 ID',
  },
  global: {
    title: '海外官方',
    description: '官方协议通道',
    detail: 'OpenAI、Anthropic、Google',
  },
};

interface LlmConfigDrawerProps {
  open: boolean;
  editing: LLMConfig | null;
  title?: string;
  saving?: boolean;
  initialPresetRegion?: ProviderRegion;
  onClose: () => void;
  onSubmit: (payload: Partial<LLMConfig>) => void;
}

function formLlm(record?: LLMConfig | null) {
  return {
    ...(record || defaultLlm),
    api_key: '',
  };
}

function modelDefaults() {
  return {
    name: '',
    is_reasoning_model: false,
  };
}

function normalizeModels(models: LLMConfig['available_models'] | undefined) {
  return (models || []).map((model) => ({
    name: String(model.name || '').trim(),
    is_reasoning_model: Boolean(model.is_reasoning_model),
  })).filter((model) => model.name);
}

function normalizeProviderType(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function normalizeBaseUrl(value?: string | null) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function regionForRecord(record?: LLMConfig | null, fallback: ProviderRegion = 'domestic') {
  if (!record) return fallback;
  return providerRegion(record.provider_type);
}

export function LlmConfigDrawer({
  open,
  editing,
  title,
  saving,
  initialPresetRegion = 'custom',
  onClose,
  onSubmit,
}: LlmConfigDrawerProps) {
  const [form] = Form.useForm();
  const [extraHeadersText, setExtraHeadersText] = useState('{}');
  const [presetRegion, setPresetRegion] = useState<ProviderRegion>('custom');
  const selectedProviderType = Form.useWatch('provider_type', form);
  const filteredPresets = useMemo(
    () => providerPresets.filter((item) => item.region === presetRegion),
    [presetRegion],
  );

  useEffect(() => {
    if (!open) return;
    const nextRegion = regionForRecord(editing, initialPresetRegion);
    const nextValues = formLlm(editing);
    if (!editing && nextRegion === 'custom') {
      const customPreset = providerPresets.find((item) => item.key === 'custom');
      if (customPreset) {
        Object.assign(nextValues, {
          name: customPreset.name,
          provider_type: customPreset.provider_type,
          base_url: customPreset.base_url,
          available_models: customPreset.available_models,
          default_model: customPreset.default_model,
          max_tokens: customPreset.max_tokens,
        });
      }
    }
    form.setFieldsValue(nextValues);
    setPresetRegion(nextRegion);
    setExtraHeadersText(JSON.stringify((editing || defaultLlm).extra_headers || {}, null, 2));
  }, [editing, form, initialPresetRegion, open]);

  const handleFinish = (values: Partial<LLMConfig>) => {
    let extraHeaders = {};
    try {
      extraHeaders = JSON.parse(extraHeadersText || '{}');
    } catch {
      form.setFields([{ name: 'extra_headers_json', errors: ['附加请求头必须是合法 JSON 对象'] }]);
      return;
    }
    const availableModels = normalizeModels(values.available_models);
    const defaultModel = String(values.default_model || availableModels.find((item) => item.name)?.name || '').trim();
    const modelNames = new Set(availableModels.map((item) => item.name).filter(Boolean));
    if (!modelNames.size) {
      form.setFields([{ name: 'available_models', errors: ['至少填写一个可调用模型'] }]);
      return;
    }
    if (!modelNames.has(defaultModel)) {
      form.setFields([{ name: 'default_model', errors: ['默认模型必须出现在可调用模型列表中'] }]);
      return;
    }
    const providerType = normalizeProviderType(values.provider_type);
    onSubmit({
      ...values,
      provider_type: providerType,
      base_url: normalizeBaseUrl(values.base_url),
      default_model: defaultModel,
      available_models: availableModels,
      extra_headers: extraHeaders,
    });
  };

  const applyProviderPreset = (key: string) => {
    const preset = providerPresets.find((item) => item.key === key);
    if (!preset) return;
    form.setFieldsValue({
      name: preset.name,
      provider_type: preset.provider_type,
      base_url: preset.base_url,
      available_models: preset.available_models,
      default_model: preset.default_model,
      max_tokens: preset.max_tokens,
      temperature: 0.7,
      status: 'active',
    });
    setExtraHeadersText('{}');
  };

  const choosePresetRegion = (region: ProviderRegion) => {
    setPresetRegion(region);
    if (!editing && region === 'custom') {
      applyProviderPreset('custom');
    }
  };

  return (
    <Drawer
      title={title || (editing ? '编辑模型通道' : '添加模型通道')}
      width="min(640px, calc(100vw - 16px))"
      open={open}
      onClose={onClose}
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <section className="provider-drawer-section">
          <div className="provider-drawer-section-title">
            <strong>选择来源</strong>
            <span>支持内部网关、第三方聚合服务和 OpenAI-compatible 接口；预设仅用于快速填写连接字段。</span>
          </div>
          <div className="provider-source-grid">
            {(['custom', 'domestic', 'global'] as ProviderRegion[]).map((region) => {
              const copy = sourceModeCopy[region];
              return (
                <button
                  type="button"
                  className={presetRegion === region ? 'provider-source-card active' : 'provider-source-card'}
                  key={region}
                  onClick={() => choosePresetRegion(region)}
                >
                  <strong>{copy.title}</strong>
                  <span>{copy.description}</span>
                  <em>{copy.detail}</em>
                </button>
              );
            })}
          </div>
          {presetRegion !== 'custom' ? (
            <Select
              allowClear
              placeholder="选择一个预设配置"
              options={filteredPresets.map((item) => ({
                value: item.key,
                label: item.label,
                title: item.description,
              }))}
              onChange={(value) => value && applyProviderPreset(value)}
            />
          ) : (
            <div className="provider-custom-template-note">
              <strong>自定义厂商不需要预置</strong>
              <span>通道标识建议使用 moonshot、siliconflow、internal-gateway 这类可读短名；保存时校验 Base URL、默认模型和可调用模型。</span>
            </div>
          )}
        </section>
        <Alert
          className="provider-preset-alert"
          type="info"
          showIcon
          message="仅保存连接信息、密钥状态、模型范围和连通性结果。"
        />
        {presetRegion === 'custom' && (
          <div className="provider-custom-contract">
            <strong>自定义供应商接入</strong>
            <span>优先按 OpenAI-compatible 接入；如为私有协议，可通过内部模型网关转换后在此维护。</span>
          </div>
        )}
        {presetRegion !== 'custom' && (
          <div className="provider-custom-contract subtle">
            <strong>模型 ID 以控制台为准</strong>
            <span>预设只帮助填充连接方式，不代表平台推荐或确认某个具体模型。保存前请按供应商控制台实际可用模型填写。</span>
          </div>
        )}
        <section className="provider-drawer-section">
          <div className="provider-drawer-section-title">
            <strong>连接信息</strong>
            <span>这些字段决定 Agent 实际调用哪个模型通道。</span>
          </div>
          <Form.Item name="name" label="通道名称" rules={[{ required: true }]}>
            <Input placeholder="例如 阿里云百炼 / Moonshot / 硅基流动 / 内部模型网关" />
          </Form.Item>
          <Form.Item
            name="provider_type"
            label="厂商标识"
            normalize={normalizeProviderType}
            rules={[
              { required: true, message: '请输入厂商标识' },
              {
                pattern: providerTypePattern,
                message: '仅支持小写字母、数字、点、下划线和短横线，最多 64 个字符',
              },
            ]}
            extra="可输入任意自定义厂商标识；OpenAI、Anthropic、Google 使用官方协议，其余标识按 OpenAI-compatible 接口调用。"
          >
            <Input placeholder="例如 qwen-dashscope、moonshot、siliconflow、internal-gateway" />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="Base URL"
            normalize={normalizeBaseUrl}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  const providerType = normalizeProviderType(getFieldValue('provider_type'));
                  if (!providerType) return Promise.resolve();
                  if (officialProviderAllowsEmptyBaseUrl(providerType) || value) return Promise.resolve();
                  return Promise.reject(new Error('自定义厂商需要填写 Base URL'));
                },
              }),
            ]}
            extra="OpenAI、Anthropic 和 Google 官方通道可留空；国内预设、自定义厂商和内部服务必须填写 Base URL。"
          >
            <Input placeholder="例如 https://api.example.com/v1" />
          </Form.Item>
          {editing?.api_key_configured && (
            <div className="secret-note">
              <strong>API Key 已保存</strong>
              <span>留空会保留原密钥；只有输入新值时才会覆盖。</span>
            </div>
          )}
          <Form.Item name="api_key" label="API Key">
            <Input.Password
              autoComplete="new-password"
              placeholder={editing?.api_key_configured ? '留空保留当前密钥' : '请输入 API Key'}
            />
          </Form.Item>
        </section>
        <section className="provider-drawer-section">
          <div className="provider-drawer-section-title">
            <strong>可调用模型</strong>
            <span>默认模型必须出现在可调用模型列表中，便于 Agent 绑定。</span>
          </div>
          <Form.Item name="default_model" label="默认模型" rules={[{ required: true }]}>
            <Input placeholder="例如 qwen-plus、moonshot-v1-8k、deepseek-chat" />
          </Form.Item>
          <Form.List name="available_models">
            {(fields, { add, remove }) => (
              <div className="rules-box">
                <div className="rules-title">
                  <span>可选模型</span>
                  <Button size="small" onClick={() => add(modelDefaults())}>
                    添加模型
                  </Button>
                </div>
                {fields.map((field) => (
                  <div className="model-row llm-model-row" key={field.key}>
                    <Form.Item name={[field.name, 'name']} label="模型名" rules={[{ required: true }]}>
                      <Input placeholder="模型 ID" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'is_reasoning_model']} label="推理模型" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)}>删除</Button>
                  </div>
                ))}
              </div>
            )}
          </Form.List>
        </section>
        <Collapse
          className="provider-advanced-collapse"
          items={[
            {
              key: 'advanced',
              label: '请求默认参数',
              children: (
                <>
                  <Space.Compact block>
                    <Form.Item name="temperature" label="温度" className="compact-field">
                      <InputNumber min={0} max={2} step={0.1} />
                    </Form.Item>
                    <Form.Item name="max_tokens" label="最大输出长度" className="compact-field">
                      <InputNumber min={1} />
                    </Form.Item>
                  </Space.Compact>
                  <Form.Item name="extra_headers_json" label="附加请求头 JSON">
                    <Input.TextArea
                      rows={4}
                      value={extraHeadersText}
                      onChange={(event) => setExtraHeadersText(event.target.value)}
                      placeholder='{"X-Provider": "example"}'
                    />
                  </Form.Item>
                  <Form.Item name="status" label="状态">
                    <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '禁用' }]} />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
        <Button type="primary" htmlType="submit" loading={saving} disabled={!selectedProviderType}>
          保存
        </Button>
      </Form>
    </Drawer>
  );
}
