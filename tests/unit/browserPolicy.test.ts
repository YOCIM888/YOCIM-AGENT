import { describe, expect, it } from 'vitest'
import {
  BROWSER_ACTION_METHODS,
  BROWSER_ALLOWED_METHODS,
  BROWSER_OBSERVE_METHODS,
  BROWSER_WAIT_KINDS,
  isBrowserActionMethod,
  isBrowserCdpMethod,
  isBrowserObserveMethod,
  isBrowserWaitKind,
  isSafeEvaluateExpression,
  redactHeaders,
  summarizeCdpParams
} from '../../src/shared/browser'
import {
  BROWSER_SETTINGS_DEFAULTS,
  normalizeBrowserSettings
} from '../../src/shared/settings'

describe('browser CDP primitives', () => {
  it('exposes thin CDP methods split into observe/action sets', () => {
    expect(BROWSER_OBSERVE_METHODS).toContain('Page.captureScreenshot')
    expect(BROWSER_OBSERVE_METHODS).toContain('Runtime.evaluate')
    expect(BROWSER_OBSERVE_METHODS).toContain('Accessibility.getFullAXTree')
    expect(BROWSER_ACTION_METHODS).toContain('Page.navigate')
    expect(BROWSER_ACTION_METHODS).toContain('Input.dispatchMouseEvent')
    expect(BROWSER_ACTION_METHODS).toContain('Input.dispatchKeyEvent')
    // 不提供 click()/type() 这类固定动作封装
    expect(BROWSER_ALLOWED_METHODS.some((method) => /\.click$|\.type$/.test(method))).toBe(false)
    expect(isBrowserCdpMethod('Page.navigate')).toBe(true)
    expect(isBrowserCdpMethod('Browser.getVersion')).toBe(false)
    expect(isBrowserActionMethod('Input.dispatchMouseEvent')).toBe(true)
    expect(isBrowserObserveMethod('Page.captureScreenshot')).toBe(true)
  })

  it('supports explicit wait primitives without sleep-only APIs', () => {
    expect(BROWSER_WAIT_KINDS).toEqual(['networkIdle', 'selector', 'expression', 'load'])
    expect(isBrowserWaitKind('networkIdle')).toBe(true)
    expect(isBrowserWaitKind('sleep')).toBe(false)
  })

  it('redacts sensitive headers before they reach the event stream', () => {
    const redacted = redactHeaders({
      Authorization: 'Bearer secret-token',
      Cookie: 'session=abc',
      'SET-COOKIE': 'token=xyz',
      'X-Api-Key': 'key-123',
      Accept: 'text/html'
    })
    expect(redacted['Authorization']).toBe('[REDACTED]')
    expect(redacted['Cookie']).toBe('[REDACTED]')
    expect(redacted['SET-COOKIE']).toBe('[REDACTED]')
    expect(redacted['X-Api-Key']).toBe('[REDACTED]')
    expect(redacted['Accept']).toBe('text/html')
  })

  it('blocks obvious Node/Electron escapes in Runtime.evaluate', () => {
    expect(isSafeEvaluateExpression('document.title')).toBe(true)
    expect(isSafeEvaluateExpression('document.querySelectorAll("a").length')).toBe(true)
    expect(isSafeEvaluateExpression('require("node:fs")')).toBe(false)
    expect(isSafeEvaluateExpression('process.env')).toBe(false)
    expect(isSafeEvaluateExpression('window.require("electron")')).toBe(false)
    expect(isSafeEvaluateExpression('import("node:child_process")')).toBe(false)
  })

  it('summarizes params without dumping long values', () => {
    const summary = summarizeCdpParams({ url: 'https://example.com', expression: 'x'.repeat(5000) })
    expect(summary).toContain('url=https://example.com')
    expect(summary.length).toBeLessThanOrEqual(4100)
  })
})

describe('browser settings', () => {
  it('defaults to visible, isolated-profile, evaluate-enabled', () => {
    const settings = normalizeBrowserSettings({})
    expect(settings.enabled).toBe(BROWSER_SETTINGS_DEFAULTS.enabled)
    expect(settings.headless).toBe(false)
    expect(settings.inheritProfile).toBe(false)
    expect(settings.allowEvaluate).toBe(true)
    expect(settings.idleRecycleMinutes).toBe(BROWSER_SETTINGS_DEFAULTS.idleRecycleMinutes)
  })

  it('clamps idle recycle minutes and accepts explicit opt-ins', () => {
    expect(normalizeBrowserSettings({ idleRecycleMinutes: -5 }).idleRecycleMinutes).toBe(0)
    expect(normalizeBrowserSettings({ idleRecycleMinutes: 99999 }).idleRecycleMinutes).toBe(1440)
    const opted = normalizeBrowserSettings({
      headless: true,
      inheritProfile: true,
      allowEvaluate: false,
      enabled: false
    })
    expect(opted.headless).toBe(true)
    expect(opted.inheritProfile).toBe(true)
    expect(opted.allowEvaluate).toBe(false)
    expect(opted.enabled).toBe(false)
  })
})
