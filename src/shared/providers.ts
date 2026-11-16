import { CONTEXT_WINDOW_DEFAULT, clampContextWindow } from './context'

export type ProviderProtocol = 'openai' | 'anthropic' | 'gemini'

/** 思考强度档位：default 表示不发送任何思考参数，由模型按默认行为处理 */
export const REASONING_EFFORT_LEVELS = ['default', 'low', 'medium', 'high'] as const
export type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number]
export const REASONING_EFFORT_DEFAULT: ReasoningEffort = 'default'

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  default: '默认',
  low: '低',
  medium: '中',
  high: '高'
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'default' || value === 'low' || value === 'medium' || value === 'high'
}

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
  'openai',
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
  /** 每个模型可单独设置的上下文窗口（token），未设置时用默认 200K */
  contextWindows?: Record<string, number>
  /** 每个模型可单独设置的思考强度，未设置时为 default（不发思考参数） */
  reasoningEfforts?: Record<string, ReasoningEffort>
}

export interface PublicProvider extends ProviderConfig {
  hasApiKey: boolean
}

/** 读取某模型的上下文窗口：缺省 200K，越界自动收敛到 200K–1M */
export function resolveContextWindow(
  provider: Pick<ProviderConfig, 'contextWindows'> | null | undefined,
  model: string
): number {
  const value = provider?.contextWindows?.[model]
  if (typeof value !== 'number') return CONTEXT_WINDOW_DEFAULT
  return clampContextWindow(value)
}

/** 读取某模型的思考强度：缺省 default，非法值收敛为 default */
export function resolveReasoningEffort(
  provider: Pick<ProviderConfig, 'reasoningEfforts'> | null | undefined,
  model: string
): ReasoningEffort {
  const value = provider?.reasoningEfforts?.[model]
  return isReasoningEffort(value) ? value : REASONING_EFFORT_DEFAULT
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
    models: ['deepseek-v4-pro', 'deepseek-flash'],
    requiresApiKey: true,
    envKey: 'DEEPSEEK_API_KEY',
    description:
      'DeepSeek 官方 API，OpenAI 兼容。deepseek-flash 即 V4.1-Flash，deepseek-v4-pro 为旗舰推理模型。'
  },
  {
    id: 'qwen',
    name: 'Qwen（通义千问）',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3-coder-plus'],
    requiresApiKey: true,
    envKey: 'DASHSCOPE_API_KEY',
    description: '阿里云百炼 DashScope 兼容模式。'
  },
  {
    id: 'bigmodel',
    name: 'BigModel（智谱）',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-4.7-flash'],
    requiresApiKey: true,
    envKey: 'ZHIPU_API_KEY',
    description: '智谱 BigModel GLM 系列，glm-4.7-flash 为免费模型。'
  },
  {
    id: 'kimi',
    name: 'Kimi（Moonshot）',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k3.1-pro', 'kimi-k3', 'kimi-k2.7-code'],
    requiresApiKey: true,
    envKey: 'MOONSHOT_API_KEY',
    description: '月之暗面 Kimi / Moonshot API。K3 系列为 1M 上下文旗舰。'
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    protocol: 'openai',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
    requiresApiKey: true,
    envKey: 'MINIMAX_API_KEY',
    description: 'MiniMax 国内站 OpenAI 兼容接口。'
  },
  {
    id: 'tencent',
    name: '腾讯云（混元）',
    protocol: 'openai',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    models: ['hy3', 'hy3-preview', 'hunyuan-vision-latest'],
    requiresApiKey: true,
    envKey: 'HUNYUAN_API_KEY',
    description: '腾讯混元大模型 OpenAI 兼容接口，现役主力为 Hy3。'
  },
  {
    id: 'aliyun',
    name: '阿里云（百炼）',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.8-max', 'qwen3.7-plus', 'deepseek-v4.1-flash', 'glm-5.3', 'kimi-k3'],
    requiresApiKey: true,
    envKey: 'DASHSCOPE_API_KEY',
    description: '阿里云百炼平台，支持通义与第三方模型。'
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      'deepseek-ai/DeepSeek-V4-Pro',
      'Qwen/Qwen3.8-2.4T-A95B',
      'zai-org/GLM-5.3',
      'moonshotai/Kimi-K3'
    ],
    requiresApiKey: true,
    envKey: 'SILICONFLOW_API_KEY',
    description: 'SiliconFlow 模型聚合服务。'
  },
  {
    id: 'volcano',
    name: '火山引擎（方舟）',
    protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      'doubao-seed-2-1-pro-260915',
      'doubao-seed-2-1-lite-260915',
      'doubao-seed-2-1-turbo-260628',
      'doubao-seed-evolving'
    ],
    requiresApiKey: true,
    envKey: 'ARK_API_KEY',
    description: '火山方舟 OpenAI 兼容接口，模型名以控制台 Endpoint 为准。'
  },
  {
    id: 'openai',
    name: 'ChatGPT（OpenAI）',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'],
    requiresApiKey: true,
    envKey: 'OPENAI_API_KEY',
    description: 'OpenAI 官方 API。gpt-6-astra 为旗舰，gpt-6.1-sol 性价比最佳。'
  },
  {
    id: 'claude',
    name: 'Claude（Anthropic）',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'],
    requiresApiKey: true,
    envKey: 'ANTHROPIC_API_KEY',
    description: 'Anthropic Messages API。Claude 5.5 系列为 1M 上下文。'
  },
  {
    id: 'gemini',
    name: 'Gemini（Google）',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-4-argon', 'gemini-4-carbon', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    requiresApiKey: true,
    envKey: 'GEMINI_API_KEY',
    description: 'Google Gemini GenerateContent API。'
  },
  {
    id: 'grok',
    name: 'Grok（xAI）',
    protocol: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-build-0.1'],
    requiresApiKey: true,
    envKey: 'XAI_API_KEY',
    description: 'xAI Grok OpenAI 兼容接口，grok-build-0.1 面向编码场景。'
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen3.8', 'gpt-oss:120b', 'llama3.3'],
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
