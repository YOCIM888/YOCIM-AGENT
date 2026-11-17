import { describe, expect, it, vi } from 'vitest'
import { runBrowserCdp, runBrowserWait, type BrowserToolDeps } from '../../src/main/tools/browserCdpTools'
import type { BrowserService } from '../../src/main/browser/browserService'
import type { ToolExecutionContext } from '../../src/main/tools/toolService'
import type { BrowserWaitArgs } from '../../src/main/tools/toolSchemas'

function makeDeps(overrides: {
  execute?: (...args: unknown[]) => Promise<Record<string, unknown>>
  wait?: (...args: unknown[]) => Promise<string>
  mode?: 'manual' | 'auto' | 'open'
  decision?: string
} = {}): { deps: BrowserToolDeps; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn().mockResolvedValue(overrides.decision ?? 'approve')
  const service = {
    execute: vi.fn().mockImplementation((...args: unknown[]) =>
      (overrides.execute ?? (() => Promise.resolve({ url: 'https://example.com' })))(...args)
    ),
    wait: vi.fn().mockImplementation((...args: unknown[]) =>
      (overrides.wait ?? (() => Promise.resolve('ok')))(...args)
    )
  } as unknown as BrowserService
  return {
    deps: {
      service,
      approvals: { request } as unknown as BrowserToolDeps['approvals'],
      getApprovalMode: () => overrides.mode ?? 'auto'
    },
    request
  }
}

const context: ToolExecutionContext = {
  sessionId: 'session-1',
  runId: 'run-1',
  signal: new AbortController().signal
}

describe('AI browser CDP tool runner', () => {
  it('does not ask approval for observation methods', async () => {
    const { deps, request } = makeDeps({
      execute: () => Promise.resolve({ result: { value: 'Title from CDP' } })
    })
    const outcome = await runBrowserCdp(
      { method: 'Runtime.evaluate', params: { expression: 'document.title' }, intent: '' },
      context,
      'call-1',
      deps
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('Title from CDP')
    expect(request).not.toHaveBeenCalled()
  })

  it('turns a screenshot result into an attached image', async () => {
    const { deps } = makeDeps({ execute: () => Promise.resolve({ data: 'AAAA' }) })
    const outcome = await runBrowserCdp(
      { method: 'Page.captureScreenshot', params: {}, intent: '' },
      context,
      'call-2',
      deps
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.images?.[0]).toBe('data:image/png;base64,AAAA')
  })

  it('gates mutating methods behind approval in manual mode', async () => {
    const { deps, request } = makeDeps({ mode: 'manual', decision: 'deny' })
    const outcome = await runBrowserCdp(
      { method: 'Page.navigate', params: { url: 'https://pay.example.com' }, intent: '' },
      context,
      'call-3',
      deps
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('拒绝')
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][0]).toMatchObject({ tool: 'browser_cdp', risk: 'high' })
  })

  it('returns an actionable error when human control rejects the command', async () => {
    const { deps } = makeDeps({
      mode: 'auto',
      execute: () => Promise.reject(new Error('E_BROWSER_TAKEOVER: 人类已接管浏览器'))
    })
    const outcome = await runBrowserCdp(
      { method: 'Input.dispatchMouseEvent', params: {}, intent: '点击按钮' },
      context,
      'call-4',
      deps
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('人类已接管')
    expect(outcome.content).toContain('重试')
  })

  it('reports wait failures instead of hanging', async () => {
    const { deps } = makeDeps({ wait: () => Promise.reject(new Error('E_BROWSER_TIMEOUT: 超时')) })
    const outcome = await runBrowserWait(
      { kind: 'networkIdle', value: '', timeoutMs: 1000 } as BrowserWaitArgs,
      context,
      deps
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('超时')
  })
})
