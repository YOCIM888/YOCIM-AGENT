import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AnthropicProvider } from '../../src/main/agent/providers/anthropicProvider'
import { GeminiProvider } from '../../src/main/agent/providers/geminiProvider'
import { OpenAICompatibleProvider } from '../../src/main/agent/providers/openaiProvider'
import { migrate } from '../../src/main/db/database'
import { SettingsRepository } from '../../src/main/db/repositories'
import { SettingsService } from '../../src/main/settings/settingsService'
import {
  isReasoningEffort,
  REASONING_EFFORT_DEFAULT,
  resolveReasoningEffort,
  type ReasoningEffort
} from '../../src/shared/providers'

function createService(): SettingsService {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return new SettingsService(new SettingsRepository(db), null, {})
}

describe('思考强度 resolver', () => {
  it('defaults to default when nothing is configured', () => {
    expect(resolveReasoningEffort(null, 'm')).toBe('default')
    expect(resolveReasoningEffort({}, 'm')).toBe('default')
    expect(resolveReasoningEffort({ reasoningEfforts: {} }, 'm')).toBe('default')
  })

  it('reads per-model effort and collapses invalid values', () => {
    const provider = {
      // 模拟持久化数据里出现非法档位
      reasoningEfforts: { 'gpt-x': 'high', 'gpt-y': 'weird' } as unknown as Record<
        string,
        ReasoningEffort
      >
    }
    expect(resolveReasoningEffort(provider, 'gpt-x')).toBe('high')
    expect(resolveReasoningEffort(provider, 'gpt-y')).toBe(REASONING_EFFORT_DEFAULT)
  })

  it('validates effort values', () => {
    expect(isReasoningEffort('low')).toBe(true)
    expect(isReasoningEffort('turbo')).toBe(false)
  })
})

describe('思考强度设置', () => {
  it('stores a per-model effort and returns it in the provider list', () => {
    const settings = createService()
    const result = settings.setReasoningEffort({
      providerId: 'mock',
      model: 'mock',
      effort: 'medium'
    })
    const mock = result.providers.find((provider) => provider.id === 'mock')
    expect(mock?.reasoningEfforts?.['mock']).toBe('medium')
    expect(resolveReasoningEffort(mock, 'mock')).toBe('medium')
  })

  it('rejects unknown providers', () => {
    const settings = createService()
    expect(() =>
      settings.setReasoningEffort({ providerId: 'ghost', model: 'm', effort: 'low' })
    ).toThrow(/Provider 不存在/)
  })
})

function errorResponse(): Response {
  return new Response('provider unavailable', { status: 500 })
}

describe('Provider 请求体中的思考参数', () => {
  it('openai: sends reasoning_effort only when not default', async () => {
    const bodies: string[] = []
    const makeProvider = (effort: ReasoningEffort) =>
      new OpenAICompatibleProvider({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
        model: 'm',
        reasoningEffort: effort,
        fetchImpl: async (_url, init) => {
          bodies.push(String(init.body))
          return errorResponse()
        }
      })

    await makeProvider('high')
      .stream({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)
      .next()
      .catch(() => undefined)
    await makeProvider('default')
      .stream({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)
      .next()
      .catch(() => undefined)

    expect(JSON.parse(bodies[0]).reasoning_effort).toBe('high')
    expect(JSON.parse(bodies[1]).reasoning_effort).toBeUndefined()
  })

  it('anthropic: enables thinking with a budget and raises max_tokens', async () => {
    const bodies: string[] = []
    const makeProvider = (effort: ReasoningEffort) =>
      new AnthropicProvider({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
        model: 'm',
        reasoningEffort: effort,
        fetchImpl: async (_url, init) => {
          bodies.push(String(init.body))
          return errorResponse()
        }
      })

    await makeProvider('medium')
      .stream({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)
      .next()
      .catch(() => undefined)
    await makeProvider('default')
      .stream({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)
      .next()
      .catch(() => undefined)

    const withThinking = JSON.parse(bodies[0])
    expect(withThinking.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 })
    expect(withThinking.max_tokens).toBeGreaterThan(8192)
    expect(JSON.parse(bodies[1]).thinking).toBeUndefined()
  })

  it('gemini: sends thinkingConfig only when not default', async () => {
    const bodies: string[] = []
    const makeProvider = (effort: ReasoningEffort) =>
      new GeminiProvider({
        baseUrl: 'https://api.example.com/v1beta',
        apiKey: 'k',
        model: 'm',
        reasoningEffort: effort,
        fetchImpl: async (_url, init) => {
          bodies.push(String(init.body))
          return errorResponse()
        }
      })

    await makeProvider('high')
      .stream({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)
      .next()
      .catch(() => undefined)
    await makeProvider('default')
      .stream({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)
      .next()
      .catch(() => undefined)

    expect(JSON.parse(bodies[0]).generationConfig).toEqual({
      thinkingConfig: { thinkingBudget: 8192 }
    })
    expect(JSON.parse(bodies[1]).generationConfig).toBeUndefined()
  })
})
