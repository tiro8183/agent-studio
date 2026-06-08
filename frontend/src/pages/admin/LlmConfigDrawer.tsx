import { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import {
  officialProviderAllowsEmptyBaseUrl,
  providerPresets,
  providerRegion,
  type ProviderRegion,
} from '../../services/providerCatalog';
import type { LLMConfig } from '../../types/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field } from '@/components/layout';

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

interface ModelEntry {
  name: string;
  is_reasoning_model: boolean;
}

interface FormState {
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  default_model: string;
  available_models: ModelEntry[];
  temperature: number | null;
  max_tokens: number | null;
  status: string;
}

interface FormErrors {
  name?: string;
  provider_type?: string;
  base_url?: string;
  default_model?: string;
  available_models?: string;
  extra_headers_json?: string;
}

function formLlm(record?: LLMConfig | null): FormState {
  const base = record || defaultLlm;
  return {
    name: String(base.name || ''),
    provider_type: String(base.provider_type || ''),
    base_url: String(base.base_url || ''),
    api_key: '',
    default_model: String(base.default_model || ''),
    available_models: (base.available_models || []).map((m) => ({
      name: String(m.name || ''),
      is_reasoning_model: Boolean(m.is_reasoning_model),
    })),
    temperature: base.temperature ?? 0.7,
    max_tokens: base.max_tokens ?? 4096,
    status: String(base.status || 'active'),
  };
}

function modelDefaults(): ModelEntry {
  return { name: '', is_reasoning_model: false };
}

function normalizeModels(models: ModelEntry[]) {
  return models
    .map((model) => ({
      name: String(model.name || '').trim(),
      is_reasoning_model: Boolean(model.is_reasoning_model),
    }))
    .filter((model) => model.name);
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
  const [form, setForm] = useState<FormState>(() => formLlm(editing));
  const [extraHeadersText, setExtraHeadersText] = useState('{}');
  const [presetRegion, setPresetRegion] = useState<ProviderRegion>('custom');
  const [errors, setErrors] = useState<FormErrors>({});

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
          available_models: customPreset.available_models.map((m) => ({
            name: String(m.name || ''),
            is_reasoning_model: Boolean(m.is_reasoning_model),
          })),
          default_model: customPreset.default_model,
          max_tokens: customPreset.max_tokens,
        });
      }
    }
    setForm(nextValues);
    setPresetRegion(nextRegion);
    setExtraHeadersText(JSON.stringify((editing || defaultLlm).extra_headers || {}, null, 2));
    setErrors({});
  }, [editing, initialPresetRegion, open]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const setModelField = (index: number, key: keyof ModelEntry, value: string | boolean) => {
    setForm((prev) => {
      const next = prev.available_models.map((m, i) =>
        i === index ? { ...m, [key]: value } : m,
      );
      return { ...prev, available_models: next };
    });
  };

  const addModel = () => {
    setForm((prev) => ({
      ...prev,
      available_models: [...prev.available_models, modelDefaults()],
    }));
  };

  const removeModel = (index: number) => {
    setForm((prev) => ({
      ...prev,
      available_models: prev.available_models.filter((_, i) => i !== index),
    }));
  };

  const validate = (): boolean => {
    const next: FormErrors = {};
    if (!form.name.trim()) next.name = '请输入通道名称';
    const providerType = normalizeProviderType(form.provider_type);
    if (!providerType) {
      next.provider_type = '请输入厂商标识';
    } else if (!providerTypePattern.test(providerType)) {
      next.provider_type = '仅支持小写字母、数字、点、下划线和短横线，最多 64 个字符';
    }
    const baseUrl = normalizeBaseUrl(form.base_url);
    if (providerType && !officialProviderAllowsEmptyBaseUrl(providerType) && !baseUrl) {
      next.base_url = '自定义厂商需要填写 Base URL';
    }
    const availableModels = normalizeModels(form.available_models);
    if (!availableModels.length) {
      next.available_models = '至少填写一个可调用模型';
    }
    const defaultModel = String(
      form.default_model || availableModels.find((item) => item.name)?.name || '',
    ).trim();
    const modelNames = new Set(availableModels.map((item) => item.name).filter(Boolean));
    if (availableModels.length && !modelNames.has(defaultModel)) {
      next.default_model = '默认模型必须出现在可调用模型列表中';
    }
    let extraHeaders = {};
    try {
      extraHeaders = JSON.parse(extraHeadersText || '{}');
    } catch {
      next.extra_headers_json = '附加请求头必须是合法 JSON 对象';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return false;
    // All valid — submit
    const providerTypeFinal = normalizeProviderType(form.provider_type);
    const availableModelsFinal = normalizeModels(form.available_models);
    const defaultModelFinal = String(
      form.default_model || availableModelsFinal.find((item) => item.name)?.name || '',
    ).trim();
    onSubmit({
      name: form.name,
      provider_type: providerTypeFinal,
      base_url: normalizeBaseUrl(form.base_url),
      api_key: form.api_key,
      default_model: defaultModelFinal,
      available_models: availableModelsFinal,
      temperature: form.temperature ?? undefined,
      max_tokens: form.max_tokens ?? undefined,
      status: form.status as LLMConfig['status'],
      extra_headers: extraHeaders,
    });
    return true;
  };

  const applyProviderPreset = (key: string) => {
    const preset = providerPresets.find((item) => item.key === key);
    if (!preset) return;
    setForm((prev) => ({
      ...prev,
      name: preset.name,
      provider_type: preset.provider_type,
      base_url: preset.base_url,
      available_models: preset.available_models.map((m) => ({
        name: String(m.name || ''),
        is_reasoning_model: Boolean(m.is_reasoning_model),
      })),
      default_model: preset.default_model,
      max_tokens: preset.max_tokens,
      temperature: 0.7,
      status: 'active',
    }));
    setExtraHeadersText('{}');
    setErrors({});
  };

  const choosePresetRegion = (region: ProviderRegion) => {
    setPresetRegion(region);
    if (!editing && region === 'custom') {
      applyProviderPreset('custom');
    }
  };

  const providerTypeValue = normalizeProviderType(form.provider_type);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-[min(640px,calc(100vw-16px))] max-w-none flex flex-col p-0">
        <SheetHeader>
          <SheetTitle>{title || (editing ? '编辑模型通道' : '添加模型通道')}</SheetTitle>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-5">
          {/* 选择来源 */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <strong className="text-sm font-semibold text-foreground">选择来源</strong>
              <span className="text-xs text-muted-foreground">
                支持内部网关、第三方聚合服务和 OpenAI-compatible 接口；预设仅用于快速填写连接字段。
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['custom', 'domestic', 'global'] as ProviderRegion[]).map((region) => {
                const copy = sourceModeCopy[region];
                const isActive = presetRegion === region;
                return (
                  <button
                    type="button"
                    key={region}
                    onClick={() => choosePresetRegion(region)}
                    className={[
                      'flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      isActive
                        ? 'border-primary bg-primary/8 text-primary'
                        : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent/40',
                    ].join(' ')}
                  >
                    <strong className="text-xs font-semibold">{copy.title}</strong>
                    <span className="text-xs opacity-80">{copy.description}</span>
                    <em className="text-[11px] not-italic opacity-60">{copy.detail}</em>
                  </button>
                );
              })}
            </div>
            {presetRegion !== 'custom' ? (
              <Select onValueChange={(value) => value && applyProviderPreset(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择一个预设配置" />
                </SelectTrigger>
                <SelectContent>
                  {filteredPresets.map((item) => (
                    <SelectItem key={item.key} value={item.key} title={item.description}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <strong className="block text-xs font-semibold text-foreground">自定义厂商不需要预置</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  通道标识建议使用 moonshot、siliconflow、internal-gateway 这类可读短名；保存时校验 Base URL、默认模型和可调用模型。
                </span>
              </div>
            )}
          </section>

          <Alert variant="info">
            <Info />
            <AlertDescription>仅保存连接信息、密钥状态、模型范围和连通性结果。</AlertDescription>
          </Alert>

          {presetRegion === 'custom' && (
            <div className="rounded-lg border border-border bg-card px-3 py-2.5">
              <strong className="block text-xs font-semibold text-foreground">自定义供应商接入</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                优先按 OpenAI-compatible 接入；如为私有协议，可通过内部模型网关转换后在此维护。
              </span>
            </div>
          )}
          {presetRegion !== 'custom' && (
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <strong className="block text-xs font-semibold text-foreground">模型 ID 以控制台为准</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                预设只帮助填充连接方式，不代表平台推荐或确认某个具体模型。保存前请按供应商控制台实际可用模型填写。
              </span>
            </div>
          )}

          {/* 连接信息 */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <strong className="text-sm font-semibold text-foreground">连接信息</strong>
              <span className="text-xs text-muted-foreground">这些字段决定 Agent 实际调用哪个模型通道。</span>
            </div>

            <Field label="通道名称" required>
              <Input
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="例如 阿里云百炼 / Moonshot / 硅基流动 / 内部模型网关"
              />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            </Field>

            <Field
              label="厂商标识"
              required
              hint="可输入任意自定义厂商标识；OpenAI、Anthropic、Google 使用官方协议，其余标识按 OpenAI-compatible 接口调用。"
            >
              <Input
                value={form.provider_type}
                onChange={(e) => setField('provider_type', e.target.value.trim().toLowerCase())}
                placeholder="例如 qwen-dashscope、moonshot、siliconflow、internal-gateway"
              />
              {errors.provider_type && <p className="text-xs text-destructive mt-1">{errors.provider_type}</p>}
            </Field>

            <Field
              label="Base URL"
              hint="OpenAI、Anthropic 和 Google 官方通道可留空；国内预设、自定义厂商和内部服务必须填写 Base URL。"
            >
              <Input
                value={form.base_url}
                onChange={(e) => setField('base_url', e.target.value)}
                placeholder="例如 https://api.example.com/v1"
              />
              {errors.base_url && <p className="text-xs text-destructive mt-1">{errors.base_url}</p>}
            </Field>

            {editing?.api_key_configured && (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <strong className="block text-xs font-semibold text-foreground">API Key 已保存</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  留空会保留原密钥；只有输入新值时才会覆盖。
                </span>
              </div>
            )}

            <Field label="API Key">
              <Input
                type="password"
                autoComplete="new-password"
                value={form.api_key}
                onChange={(e) => setField('api_key', e.target.value)}
                placeholder={editing?.api_key_configured ? '留空保留当前密钥' : '请输入 API Key'}
              />
            </Field>
          </section>

          {/* 可调用模型 */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <strong className="text-sm font-semibold text-foreground">可调用模型</strong>
              <span className="text-xs text-muted-foreground">
                默认模型必须出现在可调用模型列表中，便于 Agent 绑定。
              </span>
            </div>

            <Field label="默认模型" required>
              <Input
                value={form.default_model}
                onChange={(e) => setField('default_model', e.target.value)}
                placeholder="例如 qwen-plus、moonshot-v1-8k、deepseek-chat"
              />
              {errors.default_model && (
                <p className="text-xs text-destructive mt-1">{errors.default_model}</p>
              )}
            </Field>

            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-sm font-medium text-foreground">可选模型</span>
                <Button type="button" size="sm" variant="outline" onClick={addModel}>
                  添加模型
                </Button>
              </div>
              {errors.available_models && (
                <p className="px-3 pt-2 text-xs text-destructive">{errors.available_models}</p>
              )}
              <div className="flex flex-col divide-y divide-border">
                {form.available_models.map((model, index) => (
                  <div key={index} className="flex items-end gap-3 px-3 py-2.5">
                    <Field label="模型名" required className="flex-1">
                      <Input
                        value={model.name}
                        onChange={(e) => setModelField(index, 'name', e.target.value)}
                        placeholder="模型 ID"
                      />
                    </Field>
                    <Field label="推理模型" className="shrink-0">
                      <div className="flex h-9 items-center">
                        <Switch
                          checked={model.is_reasoning_model}
                          onCheckedChange={(checked) =>
                            setModelField(index, 'is_reasoning_model', checked)
                          }
                        />
                      </div>
                    </Field>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="shrink-0"
                      onClick={() => removeModel(index)}
                    >
                      删除
                    </Button>
                  </div>
                ))}
                {form.available_models.length === 0 && (
                  <p className="px-3 py-3 text-xs text-muted-foreground">暂无模型，点击「添加模型」添加。</p>
                )}
              </div>
            </div>
          </section>

          {/* 请求默认参数 (Accordion) */}
          <Accordion type="single" collapsible>
            <AccordionItem value="advanced">
              <AccordionTrigger>请求默认参数</AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <Field label="温度" className="flex-1">
                      <NumberInput
                        value={form.temperature}
                        onChange={(value) => setField('temperature', value)}
                        min={0}
                        max={2}
                        step={0.1}
                      />
                    </Field>
                    <Field label="最大输出长度" className="flex-1">
                      <NumberInput
                        value={form.max_tokens}
                        onChange={(value) => setField('max_tokens', value)}
                        min={1}
                      />
                    </Field>
                  </div>

                  <Field
                    label="附加请求头 JSON"
                    hint={errors.extra_headers_json}
                  >
                    <Textarea
                      rows={4}
                      value={extraHeadersText}
                      onChange={(e) => {
                        setExtraHeadersText(e.target.value);
                        if (errors.extra_headers_json) {
                          setErrors((prev) => ({ ...prev, extra_headers_json: undefined }));
                        }
                      }}
                      placeholder='{"X-Provider": "example"}'
                      className={errors.extra_headers_json ? 'border-destructive' : ''}
                    />
                    {errors.extra_headers_json && (
                      <p className="text-xs text-destructive mt-1">{errors.extra_headers_json}</p>
                    )}
                  </Field>

                  <Field label="状态">
                    <Select
                      value={form.status}
                      onValueChange={(value) => setField('status', value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">启用</SelectItem>
                        <SelectItem value="inactive">禁用</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </SheetBody>

        <SheetFooter>
          <Button
            type="button"
            onClick={validate}
            disabled={saving || !providerTypeValue}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
