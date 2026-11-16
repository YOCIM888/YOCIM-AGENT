import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SettingsService } from '../../src/main/settings/settingsService'
import { migrate } from '../../src/main/db/database'
import { SettingsRepository } from '../../src/main/db/repositories'

function createService(): SettingsService {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return new SettingsService(new SettingsRepository(db), null, {})
}

describe('上下文窗口设置', () => {
  it('defaults to 200K when nothing is configured', () => {
    const settings = createService()
    expect(settings.getContextWindow()).toBe(200_000)
  })

  it('stores a per-model window and clamps to 200K-1M', () => {
    const settings = createService()
    settings.setContextWindow({
      providerId: 'mock',
      model: 'mock',
      contextWindow: 400_000
    })
    expect(settings.getContextWindow()).toBe(400_000)

    settings.setContextWindow({ providerId: 'mock', model: 'mock', contextWindow: 50 })
    expect(settings.getContextWindow()).toBe(200_000)

    settings.setContextWindow({ providerId: 'mock', model: 'mock', contextWindow: 5_000_000 })
    expect(settings.getContextWindow()).toBe(1_000_000)
  })

  it('returns the updated provider list with contextWindows', () => {
    const settings = createService()
    const result = settings.setContextWindow({
      providerId: 'mock',
      model: 'mock',
      contextWindow: 600_000
    })
    const mock = result.providers.find((provider) => provider.id === 'mock')
    expect(mock?.contextWindows?.['mock']).toBe(600_000)
  })

  it('rejects unknown providers', () => {
    const settings = createService()
    expect(() =>
      settings.setContextWindow({ providerId: 'ghost', model: 'm', contextWindow: 300_000 })
    ).toThrow(/Provider 不存在/)
  })
})
