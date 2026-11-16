/**
 * 应用级设置（与 Provider 配置并列的那几块）。
 * 这里只放类型、默认值与纯函数校验，主进程与渲染进程共用。
 */

/* -------------------------------------------------------------------------- */
/* 联网搜索（Tavily）                                                          */
/* -------------------------------------------------------------------------- */

/** 搜索强度：basic 平衡相关性与速度，advanced 更准但消耗 2 倍额度 */
export const SEARCH_DEPTHS = ['basic', 'advanced'] as const
export type SearchDepth = (typeof SEARCH_DEPTHS)[number]

/** 搜索主题 */
export const SEARCH_TOPICS = ['general', 'news', 'finance'] as const
export type SearchTopic = (typeof SEARCH_TOPICS)[number]

export const SEARCH_DEPTH_LABELS: Record<SearchDepth, string> = {
  basic: '基础（快，1 额度）',
  advanced: '进阶（准，2 额度）'
}

export const SEARCH_TOPIC_LABELS: Record<SearchTopic, string> = {
  general: '通用网页',
  news: '新闻资讯',
  finance: '财经资讯'
}

export const WEB_SEARCH_LIMITS = {
  /** Tavily 单次请求最多返回 20 条 */
  maxResults: 20,
  minResults: 1,
  maxQueryLength: 400,
  /** 单条结果正文截断长度（字符） */
  maxContentChars: 1200,
  /** 工具返回文本上限（字符） */
  maxToolOutputChars: 16 * 1024,
  /** 单次请求超时（毫秒） */
  timeoutMs: 30_000
} as const

export interface SearchSettings {
  /** 是否允许 Agent 调用联网搜索 */
  enabled: boolean
  /** 是否已保存 Tavily API Key（明文不外泄） */
  hasApiKey: boolean
  /** 单次搜索返回的最大结果条数 */
  maxResults: number
  /** 搜索强度 */
  searchDepth: SearchDepth
  /** 搜索主题 */
  topic: SearchTopic
  /** 是否让 Tavily 附带一段摘要答案 */
  includeAnswer: boolean
  /** 是否附带网页原始正文 */
  includeRawContent: boolean
}

export const SEARCH_SETTINGS_DEFAULTS: SearchSettings = {
  enabled: false,
  hasApiKey: false,
  maxResults: 5,
  searchDepth: 'basic',
  topic: 'general',
  includeAnswer: true,
  includeRawContent: false
}

export function isSearchDepth(value: unknown): value is SearchDepth {
  return value === 'basic' || value === 'advanced'
}

export function isSearchTopic(value: unknown): value is SearchTopic {
  return value === 'general' || value === 'news' || value === 'finance'
}

/**
 * 设置仓储在写入时会自己做一次 JSON.stringify，
 * 这里兼容「已经被序列化过的字符串」这种形态，避免读出来是字符串而不是对象。
 */
function unwrapJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

/** 把任意来源的搜索设置收敛成合法值（存库数据可能来自旧版本或手工改坏） */
export function normalizeSearchSettings(value: unknown): SearchSettings {
  const raw = (
    typeof unwrapJson(value) === 'object' && unwrapJson(value) !== null ? unwrapJson(value) : {}
  ) as Record<string, unknown>
  const maxResults = Number(raw['maxResults'])
  return {
    enabled: raw['enabled'] === true,
    hasApiKey: raw['hasApiKey'] === true,
    maxResults: Number.isFinite(maxResults)
      ? Math.min(
          WEB_SEARCH_LIMITS.maxResults,
          Math.max(WEB_SEARCH_LIMITS.minResults, Math.round(maxResults))
        )
      : SEARCH_SETTINGS_DEFAULTS.maxResults,
    searchDepth: isSearchDepth(raw['searchDepth'])
      ? raw['searchDepth']
      : SEARCH_SETTINGS_DEFAULTS.searchDepth,
    topic: isSearchTopic(raw['topic']) ? raw['topic'] : SEARCH_SETTINGS_DEFAULTS.topic,
    includeAnswer: raw['includeAnswer'] !== false,
    includeRawContent: raw['includeRawContent'] === true
  }
}

/* -------------------------------------------------------------------------- */
/* 模型价格（账单估算）                                                        */
/* -------------------------------------------------------------------------- */

export const PRICING_LIMITS = {
  /** 单价上限（每百万 token），防止手滑填错导致离谱数字 */
  maxPrice: 1000,
  maxEntries: 200
} as const

/** 常见币种 */
export const PRICING_CURRENCIES = ['USD', 'CNY'] as const
export type PricingCurrency = (typeof PRICING_CURRENCIES)[number]

export interface ModelPricing {
  /** Provider id */
  providerId: string
  /** 模型名 */
  model: string
  /** 输入价格（每百万 token） */
  inputPrice: number
  /** 输出价格（每百万 token） */
  outputPrice: number
  /** 币种 */
  currency: PricingCurrency
}

export function isPricingCurrency(value: unknown): value is PricingCurrency {
  return value === 'USD' || value === 'CNY'
}

/** 收敛价格条目：数值非法归 0，条目上限裁剪 */
export function normalizePricing(value: unknown): ModelPricing[] {
  const source = unwrapJson(value)
  if (!Array.isArray(source)) return []
  const seen = new Set<string>()
  const result: ModelPricing[] = []
  for (const item of source) {
    if (typeof item !== 'object' || item === null) continue
    const raw = item as Record<string, unknown>
    const providerId = typeof raw['providerId'] === 'string' ? raw['providerId'].trim() : ''
    const model = typeof raw['model'] === 'string' ? raw['model'].trim() : ''
    if (!providerId || !model) continue
    const key = `${providerId}::${model}`
    if (seen.has(key)) continue
    seen.add(key)
    const inputPrice = Number(raw['inputPrice'])
    const outputPrice = Number(raw['outputPrice'])
    result.push({
      providerId,
      model,
      inputPrice: Number.isFinite(inputPrice)
        ? Math.min(PRICING_LIMITS.maxPrice, Math.max(0, inputPrice))
        : 0,
      outputPrice: Number.isFinite(outputPrice)
        ? Math.min(PRICING_LIMITS.maxPrice, Math.max(0, outputPrice))
        : 0,
      currency: isPricingCurrency(raw['currency']) ? raw['currency'] : 'USD'
    })
    if (result.length >= PRICING_LIMITS.maxEntries) break
  }
  return result
}

/** 估算一次调用的费用（输入/输出 token + 单价） */
export function estimateCost(
  pricing: ModelPricing | undefined,
  inputTokens: number,
  outputTokens: number
): number {
  if (!pricing) return 0
  const input = (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPrice
  const output = (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPrice
  return input + output
}

/* -------------------------------------------------------------------------- */
/* 存储                                                                        */
/* -------------------------------------------------------------------------- */

export interface StorageSettings {
  /**
   * 自定义数据目录（数据库、日志、时间线快照、扩展）。
   * 空字符串表示使用系统默认目录（Electron userData）。
   */
  dataDir: string
}

export const STORAGE_SETTINGS_DEFAULTS: StorageSettings = {
  dataDir: ''
}

export function normalizeStorageSettings(value: unknown): StorageSettings {
  const unwrapped = unwrapJson(value)
  const raw = (typeof unwrapped === 'object' && unwrapped !== null ? unwrapped : {}) as Record<
    string,
    unknown
  >
  const dataDir = typeof raw['dataDir'] === 'string' ? raw['dataDir'].trim() : ''
  return { dataDir: dataDir.replace(/[\\/]+$/, '') }
}
