import type { ChatProvider } from '../../shared/agent'
import { AppError } from '../../shared/errors'
import type { SettingsUpdateRequest } from '../../shared/ipc'
import type { PublicSettings } from '../../shared/session'
import { MockProvider } from '../agent/providers/mockProvider'
import { OpenAICompatibleProvider } from '../agent/providers/openaiProvider'
import type { SettingsRepository } from '../db/repositories'

export interface SettingsCrypto {
  encrypt(text: string): string
  decrypt(value: string): string
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly crypto: SettingsCrypto | null,
    private readonly envKey: string | null = process.env['OPENAI_API_KEY'] ?? null
  ) {}

  getPublic(): PublicSettings {
    const provider = this.repo.get('provider') === 'openai' ? 'openai' : 'mock'
    return {
      provider,
      baseUrl: readString(this.repo.get('baseUrl')),
      model: readString(this.repo.get('model')),
      hasApiKey: Boolean(this.getApiKey())
    }
  }

  update(input: SettingsUpdateRequest): PublicSettings {
    this.repo.set('provider', input.provider)
    this.repo.set('baseUrl', input.baseUrl.trim())
    this.repo.set('model', input.model.trim())

    if (input.apiKey !== undefined) {
      const key = input.apiKey.trim()
      if (!key) {
        this.repo.delete('apiKeyEncrypted')
      } else {
        if (!this.crypto) {
          throw new AppError('E_UNSUPPORTED', '当前环境不支持安全存储，无法保存 API Key')
        }
        this.repo.set('apiKeyEncrypted', this.crypto.encrypt(key))
      }
    }

    return this.getPublic()
  }

  getApiKey(): string | null {
    if (this.envKey) return this.envKey
    const encrypted = this.repo.get('apiKeyEncrypted')
    if (typeof encrypted !== 'string' || !this.crypto) return null
    try {
      return this.crypto.decrypt(encrypted)
    } catch {
      return null
    }
  }

  createProvider(): ChatProvider {
    const settings = this.getPublic()
    if (settings.provider === 'mock') {
      return new MockProvider()
    }

    const apiKey = this.getApiKey()
    if (!settings.baseUrl || !settings.model || !apiKey) {
      throw new AppError('E_INVALID_INPUT', '请先在设置中填写 Base URL、模型名称与 API Key')
    }

    return new OpenAICompatibleProvider({
      baseUrl: settings.baseUrl,
      apiKey,
      model: settings.model
    })
  }
}
