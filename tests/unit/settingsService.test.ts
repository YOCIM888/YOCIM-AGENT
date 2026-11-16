import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { AnthropicProvider } from '../../src/main/agent/providers/anthropicProvider'
import { GeminiProvider } from '../../src/main/agent/providers/geminiProvider'
import { MockProvider } from '../../src/main/agent/providers/mockProvider'
import { OpenAICompatibleProvider } from '../../src/main/agent/providers/openaiProvider'
import { migrate } from '../../src/main/db/database'
import { SettingsRepository } from '../../src/main/db/repositories'
import { SettingsService, type SettingsCrypto } from '../../src/main/settings/settingsService'

const crypto: SettingsCrypto = {
  encrypt: (value) => `enc:${Buffer.from(value, 'utf8').toString('base64')}`,
  decrypt: (value) => {
    if (!value.startsWith('enc:')) throw new Error('bad payload')
    return Buffer.from(value.slice(4), 'base64').toString('utf8')
  }
}

let db: DatabaseSync
let repo: SettingsRepository
let service: SettingsService

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
  repo = new SettingsRepository(db)
  service = new SettingsService(repo, crypto, null)
})

function saveDeepSeek(
  overrides: Partial<Parameters<SettingsService['saveProvider']>[0]> = {}
): ReturnType<SettingsService['saveProvider']> {
  return service.saveProvider({
    presetId: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    ...overrides
  })
}

describe('SettingsService providers', () => {
  it('defaults to the mock provider without secrets', () => {
    const settings = service.getPublic()
    expect(settings.activeProviderId).toBe('mock')
    expect(settings.activeModel).toBe('mock')
    expect(settings.approvalMode).toBe('auto')
    expect(settings.providers).toHaveLength(1)
    expect(settings.providers[0]).toMatchObject({
      id: 'mock',
      name: 'Mock（离线）',
      hasApiKey: false
    })
    expect(service.createProvider()).toBeInstanceOf(MockProvider)
    db.close()
  })

  it('persists the approval mode', () => {
    expect(service.getApprovalMode()).toBe('auto')
    expect(service.setApprovalMode({ mode: 'manual' }).approvalMode).toBe('manual')
    expect(service.getApprovalMode()).toBe('manual')
    expect(service.setApprovalMode({ mode: 'auto' }).approvalMode).toBe('auto')
    expect(service.getApprovalMode()).toBe('auto')
    expect(service.setApprovalMode({ mode: 'open' }).approvalMode).toBe('open')
    expect(service.getApprovalMode()).toBe('open')
    db.close()
  })

  it('adds a provider, stores its key encrypted and activates it', () => {
    const settings = saveDeepSeek({ apiKey: 'sk-deepseek' })
    const provider = settings.providers.find((item) => item.presetId === 'deepseek')

    expect(provider).toBeDefined()
    expect(provider?.hasApiKey).toBe(true)
    expect(settings.activeProviderId).toBe(provider?.id)
    expect(settings.activeModel).toBe('deepseek-chat')
    expect(JSON.stringify(settings)).not.toContain('sk-deepseek')

    const stored = repo.get(`providerApiKey:${provider?.id}`)
    expect(typeof stored).toBe('string')
    expect(stored).not.toContain('sk-deepseek')
    expect(service.createProvider()).toBeInstanceOf(OpenAICompatibleProvider)
    db.close()
  })

  it('updates a provider, switches models and clears the key', () => {
    const settings = saveDeepSeek({ apiKey: 'sk-deepseek' })
    const provider = settings.providers.find((item) => item.presetId === 'deepseek')
    expect(provider).toBeDefined()
    if (!provider) return

    const updated = service.saveProvider({
      id: provider.id,
      presetId: 'deepseek',
      name: 'DeepSeek 主账号',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-reasoner',
      models: ['deepseek-chat', 'deepseek-reasoner']
    })
    expect(updated.providers.find((item) => item.id === provider.id)?.name).toBe('DeepSeek 主账号')
    expect(updated.activeModel).toBe('deepseek-reasoner')

    const switched = service.setActive({ providerId: provider.id, model: 'deepseek-chat' })
    expect(switched.activeModel).toBe('deepseek-chat')

    const cleared = service.saveProvider({
      id: provider.id,
      presetId: 'deepseek',
      name: 'DeepSeek',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      models: ['deepseek-chat'],
      apiKey: ''
    })
    expect(cleared.providers.find((item) => item.id === provider.id)?.hasApiKey).toBe(false)
    db.close()
  })

  it('deletes a provider and falls back to mock', () => {
    const settings = saveDeepSeek({ apiKey: 'sk' })
    const provider = settings.providers.find((item) => item.presetId === 'deepseek')
    expect(provider).toBeDefined()
    if (!provider) return

    const next = service.deleteProvider({ providerId: provider.id })
    expect(next.providers.map((item) => item.id)).toEqual(['mock'])
    expect(next.activeProviderId).toBe('mock')
    expect(repo.get(`providerApiKey:${provider.id}`)).toBeUndefined()
    expect(() => service.deleteProvider({ providerId: 'mock' })).toThrow(/不可删除/)
    db.close()
  })

  it('rejects incomplete cloud providers at creation time', () => {
    saveDeepSeek()
    expect(() => service.createProvider()).toThrow(/API Key/)
    db.close()
  })

  it('supports local providers without API keys', () => {
    const settings = service.saveProvider({
      presetId: 'ollama',
      name: '本地 Ollama',
      protocol: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3',
      models: ['qwen3']
    })
    expect(settings.activeProviderId).toContain('ollama')
    expect(service.createProvider()).toBeInstanceOf(OpenAICompatibleProvider)
    db.close()
  })

  it('creates Anthropic and Gemini providers by protocol', () => {
    service.saveProvider({
      presetId: 'claude',
      name: 'Claude',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-5',
      models: ['claude-sonnet-4-5'],
      apiKey: 'sk-ant'
    })
    expect(service.createProvider()).toBeInstanceOf(AnthropicProvider)

    service.saveProvider({
      presetId: 'gemini',
      name: 'Gemini',
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-pro',
      models: ['gemini-2.5-pro'],
      apiKey: 'gemini-key'
    })
    expect(service.createProvider()).toBeInstanceOf(GeminiProvider)
    db.close()
  })

  it('migrates legacy single-provider settings', () => {
    repo.set('provider', 'openai')
    repo.set('baseUrl', 'https://api.example.com/v1')
    repo.set('model', 'legacy-model')
    repo.set('apiKeyEncrypted', crypto.encrypt('legacy-key'))

    const settings = service.getPublic()
    const custom = settings.providers.find((item) => item.presetId === 'custom')
    expect(custom).toMatchObject({
      id: 'custom',
      baseUrl: 'https://api.example.com/v1',
      model: 'legacy-model',
      hasApiKey: true
    })
    expect(settings.activeProviderId).toBe('custom')
    expect(service.createProvider()).toBeInstanceOf(OpenAICompatibleProvider)
    db.close()
  })

  it('fails to store keys when secure storage is unavailable', () => {
    const insecure = new SettingsService(repo, null, null)
    expect(() =>
      insecure.saveProvider({
        presetId: 'deepseek',
        name: 'DeepSeek',
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        models: ['deepseek-chat'],
        apiKey: 'sk-secret'
      })
    ).toThrow(/安全存储/)
    db.close()
  })
})

describe('SettingsService app settings', () => {
  it('round-trips the search settings and hides the key', () => {
    const settings = service.setSearch({
      enabled: true,
      maxResults: 8,
      searchDepth: 'advanced',
      topic: 'news',
      includeAnswer: false,
      includeRawContent: true,
      apiKey: 'tvly-secret'
    })

    expect(settings.search).toMatchObject({
      enabled: true,
      maxResults: 8,
      searchDepth: 'advanced',
      topic: 'news',
      includeAnswer: false,
      includeRawContent: true,
      hasApiKey: true
    })
    // 读取回来的对象里不能出现明文 Key
    expect(JSON.stringify(settings.search)).not.toContain('tvly-secret')

    const config = service.getWebSearchConfig()
    expect(config).toMatchObject({ apiKey: 'tvly-secret', maxResults: 8 })
    db.close()
  })

  it('clears the search key', () => {
    service.setSearch({
      enabled: true,
      maxResults: 5,
      searchDepth: 'basic',
      topic: 'general',
      includeAnswer: true,
      includeRawContent: false,
      apiKey: 'tvly-secret'
    })
    const settings = service.clearSearchApiKey()
    expect(settings.search.hasApiKey).toBe(false)
    expect(service.getWebSearchConfig()).toBeNull()
    db.close()
  })

  it('does not expose web search until it is enabled', () => {
    service.setSearch({
      enabled: false,
      maxResults: 5,
      searchDepth: 'basic',
      topic: 'general',
      includeAnswer: true,
      includeRawContent: false,
      apiKey: 'tvly-secret'
    })
    expect(service.getWebSearchConfig()).toBeNull()
    db.close()
  })

  it('round-trips the image settings with zhipu defaults and hides the key', () => {
    const settings = service.setImage({
      enabled: true,
      provider: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/images/generations',
      model: 'cogview-3-flash',
      size: '1024x1024',
      apiKey: 'zhipu-secret'
    })

    expect(settings.image).toMatchObject({
      enabled: true,
      provider: 'zhipu',
      model: 'cogview-3-flash',
      size: '1024x1024',
      hasApiKey: true
    })
    expect(JSON.stringify(settings.image)).not.toContain('zhipu-secret')

    const config = service.getImageConfig()
    expect(config).toMatchObject({ apiKey: 'zhipu-secret', model: 'cogview-3-flash' })
    db.close()
  })

  it('clears the image key and stops exposing the config', () => {
    service.setImage({
      enabled: true,
      provider: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/images/generations',
      model: 'cogview-3-flash',
      size: '1024x1024',
      apiKey: 'zhipu-secret'
    })
    const settings = service.clearImageApiKey()
    expect(settings.image.hasApiKey).toBe(false)
    expect(service.getImageConfig()).toBeNull()
    db.close()
  })

  it('does not expose image generation until it is enabled', () => {
    service.setImage({
      enabled: false,
      provider: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/images/generations',
      model: 'cogview-3-flash',
      size: '1024x1024',
      apiKey: 'zhipu-secret'
    })
    expect(service.getImageConfig()).toBeNull()
    db.close()
  })

  it('round-trips the pricing table', () => {
    const settings = service.setPricing({
      entries: [
        {
          providerId: 'deepseek',
          model: 'deepseek-v4-pro',
          inputPrice: 2,
          outputPrice: 8,
          currency: 'CNY'
        }
      ]
    })
    expect(settings.pricing).toEqual([
      {
        providerId: 'deepseek',
        model: 'deepseek-v4-pro',
        inputPrice: 2,
        outputPrice: 8,
        currency: 'CNY'
      }
    ])
    db.close()
  })

  it('round-trips the storage directory', () => {
    const settings = service.setStorage({ dataDir: 'D://YOCIM-Data//' })
    expect(settings.storage.dataDir).toBe('D://YOCIM-Data')
    db.close()
  })
})
