export type ProviderProtocol = 'openai' | 'anthropic' | 'gemini'

export const PROVIDER_PRESET_IDS = [
  'mock',
  'deepseek',
  'qwen',
  'bigmodel',
  'kimi',
  'minimax',
  'tencent',
  'aliyun',
  'siliconflow',
  'volcano',
  'claude',
  'gemini',
  'grok',
  'ollama',
  'custom'
] as const

export type ProviderPresetId = (typeof PROVIDER_PRESET_IDS)[number]

export interface ProviderPreset {
  id: ProviderPresetId
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  models: string[]
  requiresApiKey: boolean
  envKey?: string
  description: string
}

export interface ProviderConfig {
  id: string
  presetId: ProviderPresetId
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  models: string[]
}

export interface PublicProvider extends ProviderConfig {
  hasApiKey: boolean
}

export interface ProviderSaveInput {
  id?: string
  presetId: ProviderPresetId
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  model?: string
  models?: string[]
  apiKey?: string
}

export const MOCK_PROVIDER_ID = 'mock'
export const CUSTOM_PROVIDER_PRESET: ProviderPresetId = 'custom'

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'mock',
    name: 'Mock（离线）',
    protocol: 'openai',
    baseUrl: '',
    models: ['mock'],
    requiresApiKey: false,
    description: '内置离线演示模型，用于本地体验与测试。'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    requiresApiKey: true,
    envKey: 'DEEPSEEK_API_KEY',
    description: 'DeepSeek 官方 API，OpenAI 兼容。'
  },
  {
    id: 'qwen',
    name: 'Qwen（通义千问）',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-max', 'qwen3-coder-plus', 'qwen-plus', 'qwen-turbo'],
    requiresApiKey: true,
    envKey: 'DASHSCOPE_API_KEY',
    description: '阿里云百炼 DashScope 兼容模式。'
  },
  {
    id: 'bigmodel',
    name: 'BigModel（智谱）',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5-air', 'glm-4-flash'],
    requiresApiKey: true,
    envKey: 'ZHIPU_API_KEY',
    description: '智谱 BigModel GLM 系列。'
  },
  {
    id: 'kimi',
    name: 'Kimi（Moonshot）',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-128k', 'moonshot-v1-32k'],
    requiresApiKey: true,
    envKey: 'MOONSHOT_API_KEY',
    description: '月之暗面 Kimi / Moonshot API。'
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    protocol: 'openai',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-Text-01'],
    requiresApiKey: true,
    envKey: 'MINIMAX_API_KEY',
    description: 'MiniMax 国内站 OpenAI 兼容接口。'
  },
  {
    id: 'tencent',
    name: '腾讯云（混元）',
    protocol: 'openai',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    models: ['hunyuan-turbos-latest', 'hunyuan-pro', 'hunyuan-t1-latest'],
    requiresApiKey: true,
    envKey: 'HUNYUAN_API_KEY',
    description: '腾讯混元大模型 OpenAI 兼容接口。'
  },
  {
    id: 'aliyun',
    name: '阿里云（百炼）',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-max', 'qwen3-coder-plus', 'deepseek-v3.2'],
    requiresApiKey: true,
    envKey: 'DASHSCOPE_API_KEY',
    description: '阿里云百炼平台，支持通义与第三方模型。'
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3.2', 'Qwen/Qwen3-Coder-480B-A35B-Instruct'],
    requiresApiKey: true,
    envKey: 'SILICONFLOW_API_KEY',
    description: 'SiliconFlow 模型聚合服务。'
  },
  {
    id: 'volcano',
    name: '火山引擎（方舟）',
    protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-1-6-250615', 'doubao-seed-code-preview'],
    requiresApiKey: true,
    envKey: 'ARK_API_KEY',
    description: '火山方舟 OpenAI 兼容接口，模型名以控制台 Endpoint 为准。'
  },
  {
    id: 'claude',
    name: 'Claude（Anthropic）',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    requiresApiKey: true,
    envKey: 'ANTHROPIC_API_KEY',
    description: 'Anthropic Messages API。'
  },
  {
    id: 'gemini',
    name: 'Gemini（Google）',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    requiresApiKey: true,
    envKey: 'GEMINI_API_KEY',
    description: 'Google Gemini GenerateContent API。'
  },
  {
    id: 'grok',
    name: 'Grok（xAI）',
    protocol: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-3', 'grok-3-mini'],
    requiresApiKey: true,
    envKey: 'XAI_API_KEY',
    description: 'xAI Grok OpenAI 兼容接口。'
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen3', 'llama3.3', 'deepseek-r1'],
    requiresApiKey: false,
    description: '本地 Ollama OpenAI 兼容层，无需 API Key。'
  },
  {
    id: 'custom',
    name: '自定义',
    protocol: 'openai',
    baseUrl: '',
    models: [],
    requiresApiKey: false,
    description: '自定义 OpenAI / Anthropic / Gemini 兼容端点。'
  }
]

export function getProviderPreset(id: ProviderPresetId): ProviderPreset {
  const preset = PROVIDER_PRESETS.find((item) => item.id === id)
  if (!preset) throw new Error(`未知的 Provider 预设：${id}`)
  return preset
}

export function isProviderProtocol(value: string): value is ProviderProtocol {
  return value === 'openai' || value === 'anthropic' || value === 'gemini'
}
