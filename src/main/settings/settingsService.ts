import { randomUUID } from 'node:crypto'
import type { ChatProvider } from '../../shared/agent'
import type { ApprovalMode } from '../../shared/approval'
import { CONTEXT_WINDOW_DEFAULT, clampContextWindow } from '../../shared/context'
import { AppError } from '../../shared/errors'
import type {
  ProviderDeleteRequest,
  ProviderSaveRequest,
  SettingsSetActiveRequest,
  SettingsSetApprovalModeRequest,
  SettingsSetContextWindowRequest,
  SettingsSetImageRequest,
  SettingsSetPricingRequest,
  SettingsSetReasoningEffortRequest,
  SettingsSetSearchRequest,
  SettingsSetStorageRequest
} from '../../shared/ipc'
import {
  getProviderPreset,
  MOCK_PROVIDER_ID,
  resolveReasoningEffort,
  type ProviderConfig,
  type ProviderProtocol,
  type PublicProvider
} from '../../shared/providers'
import {
  IMAGE_SETTINGS_DEFAULTS,
  normalizeImageSettings,
  normalizePricing,
  normalizeSearchSettings,
  normalizeStorageSettings,
  type ImageSettings,
  type ModelPricing,
  type SearchSettings,
  type StorageSettings
} from '../../shared/settings'
import type { PublicSettings } from '../../shared/session'
import { AnthropicProvider } from '../agent/providers/anthropicProvider'
import { GeminiProvider } from '../agent/providers/geminiProvider'
import { MockProvider } from '../agent/providers/mockProvider'
import { OpenAICompatibleProvider } from '../agent/providers/openaiProvider'
import type { SettingsRepository } from '../db/repositories'

export interface SettingsCrypto {
  encrypt(text: string): string
  decrypt(value: string): string
}

type EnvMap = Record<string, string | undefined>

const KEY_PROVIDERS = 'providers'
const KEY_ACTIVE_PROVIDER = 'activeProviderId'
const KEY_ACTIVE_MODEL = 'activeModel'
const KEY_APPROVAL_MODE = 'approvalMode'
const KEY_SEARCH = 'search'
const KEY_IMAGE = 'image'
const KEY_PRICING = 'pricing'
const KEY_STORAGE = 'storage'
const KEY_TAVILY_API_KEY = 'tavilyApiKey'
const KEY_IMAGE_API_KEY = 'imageApiKey'
const KEY_LEGACY_PROVIDER = 'provider'
const KEY_LEGACY_BASE_URL = 'baseUrl'
const KEY_LEGACY_MODEL = 'model'
const KEY_LEGACY_API_KEY = 'apiKeyEncrypted'
const PROVIDER_KEY_PREFIX = 'providerApiKey:'

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function mockConfig(): ProviderConfig {
  return {
    id: MOCK_PROVIDER_ID,
    presetId: 'mock',
    name: 'Mock（离线）',
    protocol: 'openai',
    baseUrl: '',
    model: 'mock',
    models: ['mock']
  }
}

function isProviderConfig(value: unknown): value is ProviderConfig {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.presetId === 'string' &&
    typeof item.name === 'string' &&
    (item.protocol === 'openai' || item.protocol === 'anthropic' || item.protocol === 'gemini') &&
    typeof item.baseUrl === 'string' &&
    typeof item.model === 'string' &&
    Array.isArray(item.models) &&
    item.models.every((model) => typeof model === 'string')
  )
}

function normalizeBaseUrl(value: string, providerName: string, isMock: boolean): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    if (isMock) return ''
    throw new AppError('E_INVALID_INPUT', `请填写「${providerName}」的 Base URL`)
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new AppError('E_INVALID_INPUT', `「${providerName}」的 Base URL 不是合法地址`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('E_INVALID_INPUT', `「${providerName}」的 Base URL 仅支持 http/https`)
  }
  return trimmed
}

function sanitizeModels(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 50)
}

export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly crypto: SettingsCrypto | null,
    private readonly env: EnvMap | null = process.env
  ) {}

  getPublic(): PublicSettings {
    const providers = this.ensureProviders()
    const activeProviderId = this.resolveActiveProviderId(providers)
    const activeProvider =
      providers.find((provider) => provider.id === activeProviderId) ?? providers[0]
    const activeModel = this.resolveActiveModel(activeProvider)

    return {
      providers: providers.map((provider) => this.toPublicProvider(provider)),
      activeProviderId: activeProvider.id,
      activeModel,
      approvalMode: this.getApprovalMode(),
      search: this.getSearchSettings(),
      image: this.getImageSettings(),
      pricing: this.getPricing(),
      storage: this.getStorageSettings()
    }
  }

  /* ------------------------------------------------------------------ */
  /* 联网搜索（Tavily）                                                   */
  /* ------------------------------------------------------------------ */

  getSearchSettings(): SearchSettings {
    const stored = normalizeSearchSettings(this.repo.get(KEY_SEARCH))
    return { ...stored, hasApiKey: Boolean(this.getTavilyApiKey()) }
  }

  /** 供 web_search 工具使用：未启用或没配 Key 时返回 null */
  getWebSearchConfig(): {
    apiKey: string
    maxResults: number
    searchDepth: SearchSettings['searchDepth']
    topic: SearchSettings['topic']
    includeAnswer: boolean
    includeRawContent: boolean
  } | null {
    const settings = this.getSearchSettings()
    if (!settings.enabled || !settings.hasApiKey) return null
    return {
      apiKey: this.getTavilyApiKey() ?? '',
      maxResults: settings.maxResults,
      searchDepth: settings.searchDepth,
      topic: settings.topic,
      includeAnswer: settings.includeAnswer,
      includeRawContent: settings.includeRawContent
    }
  }

  setSearch(input: SettingsSetSearchRequest): PublicSettings {
    const current = normalizeSearchSettings(this.repo.get(KEY_SEARCH))
    const next: SearchSettings = {
      ...current,
      enabled: input.enabled,
      maxResults: input.maxResults,
      searchDepth: input.searchDepth,
      topic: input.topic,
      includeAnswer: input.includeAnswer,
      includeRawContent: input.includeRawContent,
      hasApiKey: current.hasApiKey
    }
    this.repo.set(KEY_SEARCH, next)
    if (input.apiKey !== undefined) {
      this.storeSecret(KEY_TAVILY_API_KEY, input.apiKey.trim())
    }
    return this.getPublic()
  }

  /** 清除 Tavily API Key（设置面板的「清除」按钮） */
  clearSearchApiKey(): PublicSettings {
    this.repo.delete(KEY_TAVILY_API_KEY)
    return this.getPublic()
  }

  /* ------------------------------------------------------------------ */
  /* 生图（智谱 cogview-3-flash / 自定义 API）                             */
  /* ------------------------------------------------------------------ */

  getImageSettings(): ImageSettings {
    const stored = normalizeImageSettings(this.repo.get(KEY_IMAGE))
    return { ...stored, hasApiKey: Boolean(this.getImageApiKey()) }
  }

  /** 供 generate_image 工具使用：未启用或没配 Key 时返回 null */
  getImageConfig(): {
    apiKey: string
    baseUrl: string
    model: string
    size: ImageSettings['size']
  } | null {
    const settings = this.getImageSettings()
    if (!settings.enabled || !settings.hasApiKey) return null
    return {
      apiKey: this.getImageApiKey() ?? '',
      baseUrl: settings.baseUrl,
      model: settings.model,
      size: settings.size
    }
  }

  setImage(input: SettingsSetImageRequest): PublicSettings {
    const current = normalizeImageSettings(this.repo.get(KEY_IMAGE))
    const next: ImageSettings = {
      ...current,
      enabled: input.enabled,
      provider: input.provider,
      baseUrl: input.baseUrl.trim() || IMAGE_SETTINGS_DEFAULTS.baseUrl,
      model: input.model.trim() || IMAGE_SETTINGS_DEFAULTS.model,
      size: input.size,
      hasApiKey: current.hasApiKey
    }
    this.repo.set(KEY_IMAGE, next)
    if (input.apiKey !== undefined) {
      this.storeSecret(KEY_IMAGE_API_KEY, input.apiKey.trim())
    }
    return this.getPublic()
  }

  /** 清除生图 API Key（设置面板的「清除」按钮） */
  clearImageApiKey(): PublicSettings {
    this.repo.delete(KEY_IMAGE_API_KEY)
    return this.getPublic()
  }

  /* ------------------------------------------------------------------ */
  /* 模型价格（账单估算）                                                 */
  /* ------------------------------------------------------------------ */

  getPricing(): ModelPricing[] {
    return normalizePricing(this.repo.get(KEY_PRICING))
  }

  setPricing(input: SettingsSetPricingRequest): PublicSettings {
    const next = normalizePricing(input.entries)
    this.repo.set(KEY_PRICING, next)
    return this.getPublic()
  }

  /* ------------------------------------------------------------------ */
  /* 存储                                                                */
  /* ------------------------------------------------------------------ */

  getStorageSettings(): StorageSettings {
    return normalizeStorageSettings(this.repo.get(KEY_STORAGE))
  }

  setStorage(input: SettingsSetStorageRequest): PublicSettings {
    const next = normalizeStorageSettings({ dataDir: input.dataDir })
    this.repo.set(KEY_STORAGE, next)
    return this.getPublic()
  }

  getApprovalMode(): ApprovalMode {
    const value = this.repo.get(KEY_APPROVAL_MODE)
    return value === 'auto' || value === 'open' ? value : 'manual'
  }

  setApprovalMode(input: SettingsSetApprovalModeRequest): PublicSettings {
    this.repo.set(KEY_APPROVAL_MODE, input.mode)
    return this.getPublic()
  }

  saveProvider(input: ProviderSaveRequest): PublicSettings {
    const providers = this.ensureProviders()
    const preset = getProviderPreset(input.presetId)
    const existing = input.id
      ? (providers.find((provider) => provider.id === input.id) ?? null)
      : null
    if (input.id && !existing) {
      throw new AppError('E_NOT_FOUND', '要更新的 Provider 不存在')
    }
    if (existing?.id === MOCK_PROVIDER_ID) {
      throw new AppError('E_INVALID_INPUT', '内置 Mock Provider 不可修改')
    }
    if (!existing && input.presetId === MOCK_PROVIDER_ID) {
      throw new AppError('E_INVALID_INPUT', '内置 Mock Provider 无需添加')
    }

    const id =
      existing?.id ??
      (preset.id === MOCK_PROVIDER_ID
        ? MOCK_PROVIDER_ID
        : providers.some((provider) => provider.id === preset.id)
          ? `${preset.id}-${randomUUID().slice(0, 8)}`
          : preset.id)
    const name = input.name.trim() || preset.name
    const protocol: ProviderProtocol =
      preset.id === 'custom' || preset.id === MOCK_PROVIDER_ID ? input.protocol : preset.protocol
    const baseUrl = normalizeBaseUrl(
      input.baseUrl || preset.baseUrl,
      name,
      preset.id === MOCK_PROVIDER_ID
    )
    const providedModels = input.models ?? []
    const models = sanitizeModels(providedModels.length ? providedModels : preset.models)
    const model = ((input.model ?? '').trim() || models[0] || '').trim()
    if (preset.id !== MOCK_PROVIDER_ID && !model) {
      throw new AppError('E_INVALID_INPUT', `请为「${name}」至少填写一个模型`)
    }

    const config: ProviderConfig = {
      id,
      presetId: input.presetId,
      name,
      protocol,
      baseUrl,
      model,
      models: models.length ? models : [model]
    }

    const index = providers.findIndex((provider) => provider.id === id)
    if (index >= 0) {
      providers[index] = config
    } else {
      providers.push(config)
    }

    if (input.apiKey !== undefined) {
      this.storeApiKey(id, input.apiKey.trim())
    }

    this.repo.set(KEY_PROVIDERS, JSON.stringify(providers))
    if (!existing || id === existing.id) {
      this.repo.set(KEY_ACTIVE_PROVIDER, id)
      this.repo.set(KEY_ACTIVE_MODEL, model)
      config.model = model
    }
    return this.getPublic()
  }

  deleteProvider(input: ProviderDeleteRequest): PublicSettings {
    const providers = this.ensureProviders()
    if (input.providerId === MOCK_PROVIDER_ID) {
      throw new AppError('E_INVALID_INPUT', '内置 Mock Provider 不可删除')
    }
    const next = providers.filter((provider) => provider.id !== input.providerId)
    if (next.length === providers.length) {
      throw new AppError('E_NOT_FOUND', 'Provider 不存在')
    }
    this.repo.delete(`${PROVIDER_KEY_PREFIX}${input.providerId}`)
    this.repo.set(KEY_PROVIDERS, JSON.stringify(next))
    if (this.repo.get(KEY_ACTIVE_PROVIDER) === input.providerId) {
      this.repo.set(KEY_ACTIVE_PROVIDER, MOCK_PROVIDER_ID)
      this.repo.set(KEY_ACTIVE_MODEL, 'mock')
    }
    return this.getPublic()
  }

  setActive(input: SettingsSetActiveRequest): PublicSettings {
    const providers = this.ensureProviders()
    const provider = providers.find((item) => item.id === input.providerId)
    if (!provider) throw new AppError('E_NOT_FOUND', 'Provider 不存在')
    const model = input.model.trim()
    if (!model) throw new AppError('E_INVALID_INPUT', '请选择模型')
    if (!provider.models.includes(model)) {
      provider.models = [...provider.models, model]
    }
    provider.model = model
    this.repo.set(KEY_PROVIDERS, JSON.stringify(providers))
    this.repo.set(KEY_ACTIVE_PROVIDER, provider.id)
    this.repo.set(KEY_ACTIVE_MODEL, model)
    return this.getPublic()
  }

  /** 每模型上下文窗口（200K–1M），供用量圆环与自动压缩使用 */
  setContextWindow(input: SettingsSetContextWindowRequest): PublicSettings {
    const providers = this.ensureProviders()
    const provider = providers.find((item) => item.id === input.providerId)
    if (!provider) throw new AppError('E_NOT_FOUND', 'Provider 不存在')
    const model = input.model.trim()
    if (!model) throw new AppError('E_INVALID_INPUT', '请选择模型')
    provider.contextWindows = {
      ...(provider.contextWindows ?? {}),
      [model]: clampContextWindow(input.contextWindow)
    }
    this.repo.set(KEY_PROVIDERS, JSON.stringify(providers))
    return this.getPublic()
  }

  /** 每模型思考强度（default/low/medium/high），供 Provider 构造时使用 */
  setReasoningEffort(input: SettingsSetReasoningEffortRequest): PublicSettings {
    const providers = this.ensureProviders()
    const provider = providers.find((item) => item.id === input.providerId)
    if (!provider) throw new AppError('E_NOT_FOUND', 'Provider 不存在')
    const model = input.model.trim()
    if (!model) throw new AppError('E_INVALID_INPUT', '请选择模型')
    provider.reasoningEfforts = {
      ...(provider.reasoningEfforts ?? {}),
      [model]: input.effort
    }
    this.repo.set(KEY_PROVIDERS, JSON.stringify(providers))
    return this.getPublic()
  }

  /** 当前激活 Provider+模型 的上下文窗口 */
  getContextWindow(): number {
    const providers = this.ensureProviders()
    const activeId = this.resolveActiveProviderId(providers)
    const provider = providers.find((item) => item.id === activeId) ?? providers[0]
    const model = this.resolveActiveModel(provider)
    if (provider.id === MOCK_PROVIDER_ID) {
      // Mock 上下文没有真实 token 计量，用默认窗口即可
      return provider.contextWindows?.[model] ?? CONTEXT_WINDOW_DEFAULT
    }
    const raw = provider.contextWindows?.[model]
    return typeof raw === 'number' ? clampContextWindow(raw) : CONTEXT_WINDOW_DEFAULT
  }

  createProvider(): ChatProvider {
    const settings = this.getPublic()
    const provider =
      settings.providers.find((item) => item.id === settings.activeProviderId) ??
      settings.providers[0]
    if (!provider) {
      throw new AppError('E_INVALID_INPUT', '没有可用的模型 Provider')
    }
    if (provider.id === MOCK_PROVIDER_ID) {
      return new MockProvider()
    }

    if (!provider.baseUrl) {
      throw new AppError('E_INVALID_INPUT', `请先在设置中为「${provider.name}」填写 Base URL`)
    }
    if (!settings.activeModel) {
      throw new AppError('E_INVALID_INPUT', `请先为「${provider.name}」选择模型`)
    }
    const apiKey = this.getApiKeyFor(provider)
    if (!apiKey && getProviderPreset(provider.presetId).requiresApiKey) {
      throw new AppError('E_INVALID_INPUT', `请先在设置中为「${provider.name}」配置 API Key`)
    }

    if (provider.protocol === 'anthropic') {
      return new AnthropicProvider({
        baseUrl: provider.baseUrl,
        apiKey: apiKey ?? '',
        model: settings.activeModel,
        reasoningEffort: resolveReasoningEffort(provider, settings.activeModel)
      })
    }
    if (provider.protocol === 'gemini') {
      return new GeminiProvider({
        baseUrl: provider.baseUrl,
        apiKey: apiKey ?? '',
        model: settings.activeModel,
        reasoningEffort: resolveReasoningEffort(provider, settings.activeModel)
      })
    }
    return new OpenAICompatibleProvider({
      baseUrl: provider.baseUrl,
      apiKey: apiKey ?? '',
      model: settings.activeModel,
      reasoningEffort: resolveReasoningEffort(provider, settings.activeModel)
    })
  }

  private ensureProviders(): ProviderConfig[] {
    const raw = this.repo.get(KEY_PROVIDERS)
    if (typeof raw === 'string') {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const providers = parsed.filter(isProviderConfig)
          if (!providers.some((provider) => provider.id === MOCK_PROVIDER_ID)) {
            providers.unshift(mockConfig())
          }
          if (providers.length) return providers
        }
      } catch {
        // 损坏时回退到默认 Provider
      }
    }
    return this.migrateLegacySettings()
  }

  private migrateLegacySettings(): ProviderConfig[] {
    const legacyProvider = this.repo.get(KEY_LEGACY_PROVIDER)
    const legacyBaseUrl = readString(this.repo.get(KEY_LEGACY_BASE_URL))
    const legacyModel = readString(this.repo.get(KEY_LEGACY_MODEL))
    const providers: ProviderConfig[] = [mockConfig()]

    if (legacyProvider === 'openai' && legacyBaseUrl) {
      const model = legacyModel || 'gpt-4o-mini'
      providers.push({
        id: 'custom',
        presetId: 'custom',
        name: 'OpenAI-compatible',
        protocol: 'openai',
        baseUrl: legacyBaseUrl.replace(/\/+$/, ''),
        model,
        models: [model]
      })
      const legacyKey = this.repo.get(KEY_LEGACY_API_KEY)
      if (typeof legacyKey === 'string') {
        this.repo.set(`${PROVIDER_KEY_PREFIX}custom`, legacyKey)
      }
      this.repo.set(KEY_ACTIVE_PROVIDER, 'custom')
      this.repo.set(KEY_ACTIVE_MODEL, model)
    } else {
      this.repo.set(KEY_ACTIVE_PROVIDER, MOCK_PROVIDER_ID)
      this.repo.set(KEY_ACTIVE_MODEL, 'mock')
    }

    this.repo.set(KEY_PROVIDERS, JSON.stringify(providers))
    return providers
  }

  private resolveActiveProviderId(providers: ProviderConfig[]): string {
    const stored = this.repo.get(KEY_ACTIVE_PROVIDER)
    const found =
      typeof stored === 'string' ? providers.find((provider) => provider.id === stored) : null
    const active = found ?? providers[0]
    if (this.repo.get(KEY_ACTIVE_PROVIDER) !== active.id) {
      this.repo.set(KEY_ACTIVE_PROVIDER, active.id)
    }
    return active.id
  }

  private resolveActiveModel(provider: ProviderConfig): string {
    const stored = this.repo.get(KEY_ACTIVE_MODEL)
    const storedModel = typeof stored === 'string' ? stored.trim() : ''
    const belongsToProvider =
      storedModel.length > 0 &&
      (provider.models.includes(storedModel) || provider.model === storedModel)
    const activeModel = belongsToProvider ? storedModel : provider.model || provider.models[0] || ''
    if (this.repo.get(KEY_ACTIVE_MODEL) !== activeModel) {
      this.repo.set(KEY_ACTIVE_MODEL, activeModel)
    }
    return activeModel
  }

  private toPublicProvider(provider: ProviderConfig): PublicProvider {
    return {
      ...provider,
      models: [...provider.models],
      hasApiKey: Boolean(this.getApiKeyFor(provider))
    }
  }

  /** 读取某个 Provider 的 API Key（账单余额查询等场景需要） */
  getProviderApiKey(providerId: string): string | null {
    const providers = this.ensureProviders()
    const provider = providers.find((item) => item.id === providerId)
    if (!provider) return null
    return this.getApiKeyFor(provider)
  }

  private storeApiKey(providerId: string, apiKey: string): void {
    const key = `${PROVIDER_KEY_PREFIX}${providerId}`
    if (!apiKey) {
      this.repo.delete(key)
      return
    }
    if (!this.crypto) {
      throw new AppError('E_UNSUPPORTED', '当前环境不支持安全存储，无法保存 API Key')
    }
    this.repo.set(key, this.crypto.encrypt(apiKey))
  }

  /** 通用密文存储（搜索 Key 等非 Provider 的密钥） */
  private storeSecret(key: string, value: string): void {
    if (!value) {
      this.repo.delete(key)
      return
    }
    if (!this.crypto) {
      throw new AppError('E_UNSUPPORTED', '当前环境不支持安全存储，无法保存 API Key')
    }
    this.repo.set(key, this.crypto.encrypt(value))
  }

  private getTavilyApiKey(): string | null {
    const encrypted = this.repo.get(KEY_TAVILY_API_KEY)
    if (typeof encrypted === 'string' && this.crypto) {
      try {
        const value = this.crypto.decrypt(encrypted)
        if (value.trim()) return value.trim()
      } catch {
        // 解密失败时继续尝试环境变量
      }
    }
    const envValue = this.env?.['TAVILY_API_KEY']
    if (typeof envValue === 'string' && envValue.trim()) return envValue.trim()
    return null
  }

  private getImageApiKey(): string | null {
    const encrypted = this.repo.get(KEY_IMAGE_API_KEY)
    if (typeof encrypted === 'string' && this.crypto) {
      try {
        const value = this.crypto.decrypt(encrypted)
        if (value.trim()) return value.trim()
      } catch {
        // 解密失败时继续尝试环境变量
      }
    }
    const envValue = this.env?.['ZHIPU_API_KEY']
    if (typeof envValue === 'string' && envValue.trim()) return envValue.trim()
    return null
  }

  private getApiKeyFor(provider: ProviderConfig): string | null {
    const encrypted = this.repo.get(`${PROVIDER_KEY_PREFIX}${provider.id}`)
    if (typeof encrypted === 'string' && this.crypto) {
      try {
        return this.crypto.decrypt(encrypted)
      } catch {
        // 解密失败时继续尝试环境变量
      }
    }
    const envKey = getProviderPreset(provider.presetId).envKey
    if (envKey && this.env) {
      const value = this.env[envKey]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return null
  }
}
