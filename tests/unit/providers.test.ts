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
      'openai',
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

  it('lists the ChatGPT preset right before Claude', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id)
    expect(ids.indexOf('openai')).toBe(ids.indexOf('claude') - 1)
    const openai = getProviderPreset('openai')
    expect(openai.name).toContain('OpenAI')
    expect(openai.protocol).toBe('openai')
    expect(openai.baseUrl).toBe('https://api.openai.com/v1')
    expect(openai.envKey).toBe('OPENAI_API_KEY')
    expect(openai.models).toContain('gpt-6-astra')
  })

  it('ships a non-empty, trimmed model list for every cloud preset', () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.id === 'custom') continue
      expect(preset.models.length).toBeGreaterThan(0)
      for (const model of preset.models) {
        expect(model).toBe(model.trim())
        expect(model.length).toBeGreaterThan(0)
      }
      expect(new Set(preset.models).size).toBe(preset.models.length)
    }
  })
})
