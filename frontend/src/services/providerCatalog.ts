import type { LLMConfig } from '../types/domain';

export type ProviderRegion = 'domestic' | 'global' | 'custom';

export interface ProviderPreset {
  key: string;
  region: ProviderRegion;
  label: string;
  description: string;
  name: string;
  provider_type: string;
  base_url: string;
  default_model: string;
  max_tokens: number;
  available_models: LLMConfig['available_models'];
}

export const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  deepseek: 'DeepSeek',
  'qwen-dashscope': '阿里云百炼',
  'volcengine-doubao': '火山方舟',
  'zhipu-glm': '智谱 GLM',
  'baidu-qianfan': '百度千帆',
  moonshot: '月之暗面',
  siliconflow: '硅基流动',
  custom: '自定义',
};

const providerRegionByType: Record<string, ProviderRegion> = {
  openai: 'global',
  anthropic: 'global',
  google: 'global',
  deepseek: 'domestic',
  'qwen-dashscope': 'domestic',
  'volcengine-doubao': 'domestic',
  'zhipu-glm': 'domestic',
  'baidu-qianfan': 'domestic',
  moonshot: 'custom',
  siliconflow: 'custom',
  custom: 'custom',
};

export const providerPresets: ProviderPreset[] = [
  {
    key: 'qwen-dashscope',
    region: 'domestic',
    label: '阿里云百炼 · 通义千问',
    description: '只预填兼容接口地址；模型 ID 请按百炼控制台实际值填写。',
    name: '阿里云百炼',
    provider_type: 'qwen-dashscope',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    default_model: '',
    max_tokens: 8192,
    available_models: [{ name: '', is_reasoning_model: false }],
  },
  {
    key: 'deepseek',
    region: 'domestic',
    label: 'DeepSeek 官方 API',
    description: '只预填接口地址；模型 ID 请按官方控制台实际值填写。',
    name: 'DeepSeek',
    provider_type: 'deepseek',
    base_url: 'https://api.deepseek.com',
    default_model: '',
    max_tokens: 8192,
    available_models: [{ name: '', is_reasoning_model: false }],
  },
  {
    key: 'volcengine-doubao',
    region: 'domestic',
    label: '火山方舟 · 豆包',
    description: '只预填方舟接口地址；模型字段通常使用接入点或模型 ID。',
    name: '火山方舟',
    provider_type: 'volcengine-doubao',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    default_model: '',
    max_tokens: 8192,
    available_models: [{ name: '', is_reasoning_model: false }],
  },
  {
    key: 'zhipu-glm',
    region: 'domestic',
    label: '智谱 GLM',
    description: '只预填接口地址；模型 ID 请按控制台实际值填写。',
    name: '智谱 GLM',
    provider_type: 'zhipu-glm',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    default_model: '',
    max_tokens: 8192,
    available_models: [{ name: '', is_reasoning_model: false }],
  },
  {
    key: 'baidu-qianfan',
    region: 'domestic',
    label: '百度千帆 · 文心',
    description: '只预填接口地址；模型 ID 请按千帆控制台实际值填写。',
    name: '百度千帆',
    provider_type: 'baidu-qianfan',
    base_url: 'https://qianfan.baidubce.com/v2',
    default_model: '',
    max_tokens: 8192,
    available_models: [{ name: '', is_reasoning_model: false }],
  },
  {
    key: 'openai',
    region: 'global',
    label: 'OpenAI',
    description: 'OpenAI 官方接口；模型 ID 请按控制台实际值填写。',
    name: 'OpenAI',
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    default_model: '',
    max_tokens: 4096,
    available_models: [{ name: '', is_reasoning_model: false }],
  },
  {
    key: 'anthropic',
    region: 'global',
    label: 'Anthropic Claude',
    description: '官方协议通道；模型 ID 请按控制台实际值填写。',
    name: 'Anthropic',
    provider_type: 'anthropic',
    base_url: '',
    default_model: '',
    max_tokens: 4096,
    available_models: [{ name: '', is_reasoning_model: false }],
  },
  {
    key: 'google',
    region: 'global',
    label: 'Google Gemini',
    description: 'Google Generative AI 官方接口；模型 ID 请按控制台实际值填写。',
    name: 'Google Gemini',
    provider_type: 'google',
    base_url: '',
    default_model: '',
    max_tokens: 4096,
    available_models: [{ name: '', is_reasoning_model: false }],
  },
  {
    key: 'custom',
    region: 'custom',
    label: '自定义厂商通道',
    description: '适合 Moonshot、硅基流动、内部模型服务或任意自定义模型网关。',
    name: '自定义厂商通道',
    provider_type: 'custom',
    base_url: '',
    default_model: '',
    max_tokens: 4096,
    available_models: [{ name: '', is_reasoning_model: false }],
  },
];

export function providerTypeLabel(value?: string | null) {
  const key = String(value || '').trim();
  return providerLabels[key] || key || '自定义';
}

export function providerRegion(value?: string | null): ProviderRegion {
  return providerRegionByType[String(value || '').trim()] || 'custom';
}

export function providerKind(item: LLMConfig): ProviderRegion {
  return providerRegion(item.provider_type);
}

export function isCustomProviderType(value?: string | null) {
  return providerRegion(value) === 'custom';
}

export function providerKindLabel(item: LLMConfig) {
  const kind = providerKind(item);
  if (kind === 'domestic') return '国内预设';
  if (kind === 'global') return '海外官方';
  return '自定义厂商';
}

export function protocolLabel(item: LLMConfig) {
  if (item.provider_type === 'openai') return 'OpenAI 官方协议';
  if (item.provider_type === 'anthropic') return 'Anthropic 官方协议';
  if (item.provider_type === 'google') return 'Google 官方协议';
  return 'OpenAI-compatible';
}

export function officialProviderAllowsEmptyBaseUrl(providerType: string) {
  return ['openai', 'anthropic', 'google'].includes(providerType);
}
