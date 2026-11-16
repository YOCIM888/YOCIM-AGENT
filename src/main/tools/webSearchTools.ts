import type { ToolExecutionOutcome } from '../../shared/agent'
import { AppError } from '../../shared/errors'
import { WEB_SEARCH_LIMITS, type SearchDepth, type SearchTopic } from '../../shared/settings'
import type { WebSearchArgs } from './toolSchemas'

type FetchFn = (input: string, init: RequestInit) => Promise<Response>

export const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

/** 联网搜索配置：来自设置面板（Tavily Key + 条数/强度/主题） */
export interface WebSearchConfig {
  apiKey: string
  maxResults: number
  searchDepth: SearchDepth
  topic: SearchTopic
  includeAnswer: boolean
  includeRawContent: boolean
}

export interface WebSearchHit {
  title: string
  url: string
  content: string
  score: number | null
}

export interface WebSearchOutcome {
  answer: string | null
  results: WebSearchHit[]
  /** 实际生效的结果条数上限 */
  maxResults: number
}

/**
 * 搜索执行器由主进程注入：API Key 只在主进程内存里流转，
 * 工具层拿到的 config 已脱敏（不落日志、不进审计）。
 */
export type WebSearchRunner = (
  query: string,
  maxResults: number,
  signal: AbortSignal
) => Promise<WebSearchOutcome>

interface TavilyResponse {
  answer?: string | null
  results?: Array<{
    title?: string
    url?: string
    content?: string
    raw_content?: string
    score?: number
  }>
}

function clip(text: string, limit: number): string {
  const value = text.replace(/\s+/g, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

async function describeHttpError(response: Response): Promise<string> {
  let detail = ''
  try {
    const text = await response.text()
    const parsed = JSON.parse(text) as { detail?: string; error?: { message?: string } }
    detail = parsed.detail ?? parsed.error?.message ?? ''
  } catch {
    // 忽略错误体解析失败
  }
  if (response.status === 401 || response.status === 403) {
    return 'Tavily 拒绝了该 API Key，请在设置 → 搜索里检查或重新填写'
  }
  if (response.status === 432) {
    return 'Tavily 额度不足，请前往 Tavily 控制台充值'
  }
  return `Tavily 返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`
}

/** 创建调用 Tavily Search API 的执行器 */
export function createTavilySearchRunner(
  getConfig: () => WebSearchConfig | null,
  fetchImpl?: FetchFn
): WebSearchRunner {
  const doFetch = fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init))
  return async (query, maxResults, signal) => {
    const config = getConfig()
    if (!config) {
      throw new AppError(
        'E_UNSUPPORTED',
        '联网搜索未启用或未配置 Tavily API Key，请先在设置 → 搜索里开启'
      )
    }
    const limit = Math.min(
      WEB_SEARCH_LIMITS.maxResults,
      Math.max(1, Math.round(maxResults || config.maxResults))
    )

    // 调用方的取消信号与超时信号合并：任一触发都中断请求
    const timeout = AbortSignal.timeout(WEB_SEARCH_LIMITS.timeoutMs)
    const combined = AbortSignal.any([signal, timeout])

    const response = await doFetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        query,
        max_results: limit,
        search_depth: config.searchDepth,
        topic: config.topic,
        include_answer: config.includeAnswer,
        include_raw_content: config.includeRawContent
      }),
      signal: combined
    })

    if (!response.ok) throw new AppError('E_IO', await describeHttpError(response))

    let payload: TavilyResponse
    try {
      payload = (await response.json()) as TavilyResponse
    } catch {
      throw new AppError('E_IO', 'Tavily 返回了无法解析的响应')
    }

    const results = (payload.results ?? []).map((item) => {
      const raw = item.raw_content ?? item.content ?? ''
      return {
        title: item.title ?? '(无标题)',
        url: item.url ?? '',
        content: clip(raw, WEB_SEARCH_LIMITS.maxContentChars),
        score: typeof item.score === 'number' ? item.score : null
      }
    })

    return {
      answer: typeof payload.answer === 'string' && payload.answer.trim() ? payload.answer : null,
      results,
      maxResults: limit
    }
  }
}

function renderOutcome(outcome: WebSearchOutcome): string {
  const blocks: string[] = []
  if (outcome.answer) {
    blocks.push(`【摘要】${outcome.answer}`)
    blocks.push('')
  }
  if (!outcome.results.length) {
    blocks.push('[没有找到匹配的结果，换个关键词或放宽主题再试一次]')
    return blocks.join('\n')
  }
  outcome.results.forEach((item, index) => {
    blocks.push(`${index + 1}. ${item.title}`)
    if (item.url) blocks.push(`   ${item.url}`)
    if (item.content) blocks.push(`   ${item.content}`)
    blocks.push('')
  })
  return blocks.join('\n')
}

/**
 * 执行一次联网搜索，把结果渲染成模型友好的文本。
 * 失败时返回可读的错误说明，而不是抛出，让 Agent 能自行调整查询词。
 */
export async function runWebSearch(
  args: WebSearchArgs,
  runner: WebSearchRunner,
  signal: AbortSignal
): Promise<ToolExecutionOutcome> {
  const query = args.query.trim()
  if (!query) {
    return { ok: false, content: '搜索关键词为空', summary: 'web_search 参数无效' }
  }
  try {
    const outcome = await runner(query, args.maxResults ?? 0, signal)
    const content = renderOutcome(outcome)
    return {
      ok: true,
      content: content.slice(0, WEB_SEARCH_LIMITS.maxToolOutputChars),
      summary: `联网搜索「${query}」：${outcome.results.length} 条结果`
    }
  } catch (error) {
    const message = error instanceof AppError ? error.message : '联网搜索失败'
    return {
      ok: false,
      content: `联网搜索失败：${message}`,
      summary: `联网搜索失败：${message}`
    }
  }
}
