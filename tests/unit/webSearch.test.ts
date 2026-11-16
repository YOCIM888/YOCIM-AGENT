import { describe, expect, it, vi } from 'vitest'
import {
  createTavilySearchRunner,
  runWebSearch,
  type WebSearchConfig
} from '../../src/main/tools/webSearchTools'

const config: WebSearchConfig = {
  apiKey: 'tvly-test',
  maxResults: 5,
  searchDepth: 'basic',
  topic: 'general',
  includeAnswer: true,
  includeRawContent: false
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as unknown as Response
}

describe('tavily search runner', () => {
  it('sends the configured options and maps results', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        answer: '摘要内容',
        results: [
          { title: '第一条', url: 'https://a.dev', content: '正文 A', score: 0.9 },
          { title: '第二条', url: 'https://b.dev', content: '正文 B' }
        ]
      })
    )
    const runner = createTavilySearchRunner(() => config, fetchImpl)
    const outcome = await runner('electron', 3, new AbortController().signal)

    expect(outcome.answer).toBe('摘要内容')
    expect(outcome.results).toHaveLength(2)
    expect(outcome.results[0].url).toBe('https://a.dev')
    expect(outcome.maxResults).toBe(3)

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.query).toBe('electron')
    expect(body.max_results).toBe(3)
    expect(body.search_depth).toBe('basic')
    expect(body.topic).toBe('general')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tvly-test')
  })

  it('falls back to the configured maxResults when none is given', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }))
    const runner = createTavilySearchRunner(() => config, fetchImpl)
    const outcome = await runner('query', 0, new AbortController().signal)
    expect(outcome.maxResults).toBe(5)
  })

  it('reports missing configuration as unsupported', async () => {
    const runner = createTavilySearchRunner(() => null, vi.fn())
    await expect(runner('query', 0, new AbortController().signal)).rejects.toThrow(/未启用/)
  })
})

describe('runWebSearch', () => {
  it('renders results as model friendly text', async () => {
    const runner = vi.fn(async () => ({
      answer: '一句话答案',
      results: [{ title: '标题', url: 'https://x.dev', content: '内容', score: null }],
      maxResults: 5
    }))
    const outcome = await runWebSearch(
      { query: '测试', maxResults: 5 },
      runner,
      new AbortController().signal
    )

    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('一句话答案')
    expect(outcome.content).toContain('https://x.dev')
    expect(outcome.summary).toContain('1 条结果')
  })

  it('turns failures into readable tool output instead of throwing', async () => {
    const runner = vi.fn(async () => {
      throw new Error('网络不可达')
    })
    const outcome = await runWebSearch({ query: '测试' }, runner, new AbortController().signal)

    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('联网搜索失败')
  })
})
