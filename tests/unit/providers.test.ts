import { describe, expect, it } from 'vitest'
import { getProviderPreset, PROVIDER_PRESETS } from '../../src/shared/providers'

describe('provider presets', () => {
  it('covers all supported providers with unique ids', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'mock',
      'deepseek',
      'qwen',
      'bigmodel',
      'kimi',
      'minimax',
      'tencent',
      'aliyun',
      'siliconflow',
      'volcano',
      'claude',
      'gemini',
      'grok',
      'ollama',
      'custom'
    ])
  })

  it('provides protocol, endpoint and models for cloud presets', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.description.length).toBeGreaterThan(0)
      if (preset.id === 'mock') continue
      if (preset.id !== 'custom') {
        expect(preset.baseUrl).toMatch(/^https?:\/\//)
      }
      expect(['openai', 'anthropic', 'gemini']).toContain(preset.protocol)
      if (preset.id !== 'custom') {
        expect(preset.models.length).toBeGreaterThan(0)
      }
    }
  })

  it('uses dedicated protocols for Claude and Gemini', () => {
    expect(getProviderPreset('claude').protocol).toBe('anthropic')
    expect(getProviderPreset('gemini').protocol).toBe('gemini')
    expect(getProviderPreset('ollama').requiresApiKey).toBe(false)
  })
})
