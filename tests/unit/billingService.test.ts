import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { BillingService } from '../../src/main/billing/billingService'
import { migrate } from '../../src/main/db/database'
import { SettingsRepository, UsageRepository } from '../../src/main/db/repositories'
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
let settings: SettingsService
let usage: UsageRepository

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  migrate(db)
  repo = new SettingsRepository(db)
  settings = new SettingsService(repo, crypto, null)
  usage = new UsageRepository(db)
})

function addDeepSeek(apiKey?: string): void {
  settings.saveProvider({
    presetId: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    models: ['deepseek-v4-pro'],
    ...(apiKey ? { apiKey } : {})
  })
}

describe('BillingService balance', () => {
  it('reports unsupported providers without calling the network', async () => {
    const service = new BillingService(usage, settings)
    const balance = await service.getBalance('mock')
    expect(balance.supported).toBe(false)
    expect(balance.totalBalance).toBeNull()
  })

  it('parses the DeepSeek balance payload', async () => {
    addDeepSeek('sk-test')
    const service = new BillingService(
      usage,
      settings,
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            is_available: true,
            balance_infos: [
              {
                currency: 'CNY',
                total_balance: '110.00',
                granted_balance: '10.00',
                topped_up_balance: '100.00'
              }
            ]
          })
        }) as unknown as Response
    )

    const balance = await service.getBalance('deepseek')
    expect(balance.supported).toBe(true)
    expect(balance.isAvailable).toBe(true)
    expect(balance.currency).toBe('CNY')
    expect(balance.totalBalance).toBeCloseTo(110, 2)
    expect(balance.grantedBalance).toBeCloseTo(10, 2)
    expect(balance.toppedUpBalance).toBeCloseTo(100, 2)
  })

  it('explains a missing API key instead of throwing', async () => {
    addDeepSeek()
    const service = new BillingService(usage, settings)
    const balance = await service.getBalance('deepseek')
    expect(balance.error).toContain('API Key')
  })
})

describe('BillingService summary', () => {
  it('estimates cost from the configured pricing', () => {
    addDeepSeek('sk-test')
    usage.insert({
      id: 'u1',
      sessionId: 's1',
      providerId: 'deepseek',
      model: 'deepseek-v4-pro',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      createdAt: Date.now()
    })
    settings.setPricing({
      entries: [
        {
          providerId: 'deepseek',
          model: 'deepseek-v4-pro',
          inputPrice: 2,
          outputPrice: 10,
          currency: 'USD'
        }
      ]
    })

    const service = new BillingService(usage, settings)
    const summary = service.getSummary()
    expect(summary.totalCalls).toBe(1)
    expect(summary.totalInputTokens).toBe(1_000_000)
    expect(summary.totalCost).toBeCloseTo(7, 6)
    expect(summary.unpricedItems).toBe(0)
    expect(summary.items[0].priced).toBe(true)
  })

  it('flags models without pricing', () => {
    addDeepSeek('sk-test')
    usage.insert({
      id: 'u1',
      sessionId: 's1',
      providerId: 'deepseek',
      model: 'deepseek-v4-pro',
      inputTokens: 100,
      outputTokens: 50,
      createdAt: Date.now()
    })

    const service = new BillingService(usage, settings)
    const summary = service.getSummary()
    expect(summary.unpricedItems).toBe(1)
    expect(summary.items[0].cost).toBeNull()
  })
})
