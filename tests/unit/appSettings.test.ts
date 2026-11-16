import { describe, expect, it } from 'vitest'
import {
  estimateCost,
  normalizePricing,
  normalizeSearchSettings,
  normalizeStorageSettings,
  SEARCH_SETTINGS_DEFAULTS,
  WEB_SEARCH_LIMITS
} from '../../src/shared/settings'

describe('search settings', () => {
  it('falls back to defaults for missing or invalid values', () => {
    const settings = normalizeSearchSettings({})
    expect(settings.enabled).toBe(false)
    expect(settings.maxResults).toBe(SEARCH_SETTINGS_DEFAULTS.maxResults)
    expect(settings.searchDepth).toBe('basic')
    expect(settings.topic).toBe('general')
    expect(settings.includeAnswer).toBe(true)
    expect(settings.includeRawContent).toBe(false)
  })

  it('clamps maxResults into the allowed range', () => {
    expect(normalizeSearchSettings({ maxResults: 0 }).maxResults).toBe(WEB_SEARCH_LIMITS.minResults)
    expect(normalizeSearchSettings({ maxResults: 999 }).maxResults).toBe(
      WEB_SEARCH_LIMITS.maxResults
    )
    expect(normalizeSearchSettings({ maxResults: 12.6 }).maxResults).toBe(13)
  })

  it('rejects unknown depth and topic', () => {
    const settings = normalizeSearchSettings({ searchDepth: 'ultra', topic: 'sports' })
    expect(settings.searchDepth).toBe('basic')
    expect(settings.topic).toBe('general')
  })
})

describe('pricing entries', () => {
  it('drops entries without provider or model and de-duplicates', () => {
    const entries = normalizePricing([
      { providerId: 'deepseek', model: 'a', inputPrice: 1, outputPrice: 2, currency: 'USD' },
      { providerId: 'deepseek', model: 'a', inputPrice: 9, outputPrice: 9, currency: 'USD' },
      { providerId: '', model: 'b', inputPrice: 1, outputPrice: 1, currency: 'USD' },
      { providerId: 'x', model: '', inputPrice: 1, outputPrice: 1, currency: 'USD' }
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0].inputPrice).toBe(1)
  })

  it('clamps negative prices to zero and unknown currency to USD', () => {
    const [entry] = normalizePricing([
      { providerId: 'p', model: 'm', inputPrice: -5, outputPrice: 3, currency: 'EUR' }
    ])
    expect(entry.inputPrice).toBe(0)
    expect(entry.outputPrice).toBe(3)
    expect(entry.currency).toBe('USD')
  })
})

describe('estimateCost', () => {
  it('computes cost from per-million-token prices', () => {
    const pricing = {
      providerId: 'p',
      model: 'm',
      inputPrice: 2,
      outputPrice: 10,
      currency: 'USD' as const
    }
    // 1M input + 0.5M output → 2 + 5
    expect(estimateCost(pricing, 1_000_000, 500_000)).toBeCloseTo(7, 6)
  })

  it('returns zero without pricing', () => {
    expect(estimateCost(undefined, 1_000_000, 1_000_000)).toBe(0)
  })
})

describe('storage settings', () => {
  it('trims trailing separators and keeps empty as default', () => {
    expect(normalizeStorageSettings({ dataDir: 'D:\\data\\' }).dataDir).toBe('D:\\data')
    expect(normalizeStorageSettings({ dataDir: '   ' }).dataDir).toBe('')
    expect(normalizeStorageSettings(null).dataDir).toBe('')
  })
})
