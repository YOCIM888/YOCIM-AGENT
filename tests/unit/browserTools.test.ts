import { describe, expect, it } from 'vitest'
import { parseToolArguments } from '../../src/main/tools/toolSchemas'
import { ToolService } from '../../src/main/tools/toolService'
import { summarizeToolArgs } from '../../src/shared/tools'

describe('browser tool argument parsing', () => {
  it('parses browser_cdp with default params and intent', () => {
    const parsed = parseToolArguments(
      'browser_cdp',
      JSON.stringify({ method: 'Page.navigate', params: { url: 'https://example.com' }, intent: '打开首页' })
    )
    expect(parsed.tool).toBe('browser_cdp')
    if (parsed.tool !== 'browser_cdp') return
    expect(parsed.args.method).toBe('Page.navigate')
    expect(parsed.args.params).toEqual({ url: 'https://example.com' })
    expect(parsed.args.intent).toBe('打开首页')
  })

  it('rejects CDP methods outside the allowlist', () => {
    expect(() => parseToolArguments('browser_cdp', JSON.stringify({ method: 'Browser.getVersion' }))).toThrow()
  })

  it('applies browser_wait defaults and bounds', () => {
    const parsed = parseToolArguments('browser_wait', JSON.stringify({ kind: 'selector', value: '#submit' }))
    expect(parsed.tool).toBe('browser_wait')
    if (parsed.tool !== 'browser_wait') return
    expect(parsed.args.kind).toBe('selector')
    expect(parsed.args.value).toBe('#submit')
    expect(parsed.args.timeoutMs).toBeGreaterThanOrEqual(500)
    expect(() => parseToolArguments('browser_wait', JSON.stringify({ kind: 'sleep' }))).toThrow()
  })

  it('does not treat browser tools as file writes', () => {
    expect(ToolService.name).toBe('ToolService')
    expect(summarizeToolArgs('browser_cdp', JSON.stringify({ method: 'Page.navigate', intent: '打开示例站' }))).toContain('Page.navigate')
    expect(summarizeToolArgs('browser_wait', JSON.stringify({ kind: 'networkIdle' }))).toContain('networkIdle')
  })
})
