import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { OpenAICompatibleProvider } from '../../src/main/agent/providers/openaiProvider'
import { MockProvider } from '../../src/main/agent/providers/mockProvider'
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

describe('SettingsService', () => {
  it('defaults to the mock provider without secrets', () => {
    expect(service.getPublic()).toEqual({
      provider: 'mock',
      baseUrl: '',
      model: '',
      hasApiKey: false
    })
    expect(service.createProvider()).toBeInstanceOf(MockProvider)
    db.close()
  })

  it('stores the API key encrypted and never returns it', () => {
    const settings = service.update({
      provider: 'openai',
      baseUrl: ' https://api.example.com/v1 ',
      model: ' test-model ',
      apiKey: 'sk-secret'
    })

    expect(settings).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      hasApiKey: true
    })
    expect(JSON.stringify(settings)).not.toContain('sk-secret')

    const stored = repo.get('apiKeyEncrypted')
    expect(typeof stored).toBe('string')
    expect(stored).not.toContain('sk-secret')
    expect(service.getApiKey()).toBe('sk-secret')
    expect(service.createProvider()).toBeInstanceOf(OpenAICompatibleProvider)
    db.close()
  })

  it('clears the stored key when an empty apiKey is provided', () => {
    service.update({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
      apiKey: 'sk-secret'
    })
    const settings = service.update({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
      apiKey: ''
    })
    expect(settings.hasApiKey).toBe(false)
    expect(service.getApiKey()).toBeNull()
    db.close()
  })

  it('refuses to create an OpenAI provider without complete configuration', () => {
    service.update({ provider: 'openai', baseUrl: '', model: '' })
    expect(() => service.createProvider()).toThrow(/Base URL/)
    db.close()
  })

  it('fails to store keys when secure storage is unavailable', () => {
    const insecure = new SettingsService(repo, null, null)
    expect(() =>
      insecure.update({
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        model: 'm',
        apiKey: 'sk-secret'
      })
    ).toThrow(/安全存储/)
    db.close()
  })
})
