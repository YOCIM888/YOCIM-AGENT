import { describe, expect, it } from 'vitest'
import {
  clampContextWindow,
  estimateMessagesTokens,
  estimateTextTokens,
  formatTokenCount,
  formatWindowSize,
  usagePercent,
  usageTone
} from '../../src/shared/context'
import { resolveContextWindow } from '../../src/shared/providers'

describe('上下文用量估算', () => {
  it('estimates CJK and ascii text differently', () => {
    const ascii = estimateTextTokens('abcdefgh') // 8 字符 ≈ 2 token
    expect(ascii).toBe(2)
    const cjk = estimateTextTokens('你好世界') // 4 字 ≈ 4 token
    expect(cjk).toBe(4)
    expect(estimateTextTokens('')).toBe(0)
  })

  it('accumulates per-message overhead', () => {
    const single = estimateMessagesTokens([{ content: 'a'.repeat(8) }])
    expect(single).toBe(2 + 4)
    expect(estimateMessagesTokens([])).toBe(0)
  })

  it('clamps context window to 200K-1M', () => {
    expect(clampContextWindow(100_000)).toBe(200_000)
    expect(clampContextWindow(2_000_000)).toBe(1_000_000)
    expect(clampContextWindow(600_000)).toBe(600_000)
    expect(clampContextWindow(Number.NaN)).toBe(200_000)
  })

  it('resolves per-model window with default fallback', () => {
    expect(resolveContextWindow(null, 'm')).toBe(200_000)
    expect(resolveContextWindow({}, 'm')).toBe(200_000)
    expect(resolveContextWindow({ contextWindows: { m: 400_000 } }, 'm')).toBe(400_000)
    expect(resolveContextWindow({ contextWindows: { m: 50 } }, 'm')).toBe(200_000)
  })

  it('computes percent and tone thresholds', () => {
    expect(usagePercent(50_000, 200_000)).toBeCloseTo(0.25)
    expect(usagePercent(300_000, 200_000)).toBe(1)
    expect(usageTone(0.2)).toBe('low')
    expect(usageTone(0.6)).toBe('medium')
    expect(usageTone(0.85)).toBe('high')
  })

  it('formats token counts and window sizes', () => {
    expect(formatTokenCount(500)).toBe('500')
    expect(formatTokenCount(124_000)).toBe('124k')
    expect(formatWindowSize(200_000)).toBe('200K')
    expect(formatWindowSize(1_000_000)).toBe('1000K')
  })
})
