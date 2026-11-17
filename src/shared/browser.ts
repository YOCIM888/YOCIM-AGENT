/**
 * AI 可操作浏览器的跨进程契约。
 *
 * 设计原则（与 main/browser/browserService.ts 对应）：
 * - CDP 是 AI 与页面之间唯一的交互层：工具只暴露少量受控原语，具体动作由 Agent 组合。
 * - 所有事件都带 sessionId：渲染层按会话过滤，禁止串会话展示。
 * - 这里只放类型、限额与纯函数，主进程与渲染进程共用，不引入 Electron/Node 依赖。
 */

/** 人类介入状态：ai=AI 可下发指令；paused=暂停 AI；human=人类接管（AI 指令同样被拒绝） */
export type BrowserControlMode = 'ai' | 'paused' | 'human'

/** 浏览器上下文生命周期状态 */
export type BrowserStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'reconnecting'
  | 'error'
  | 'disposed'

/** 浏览器上下文的隔离键：会话唯一，项目用于 profile 分区命名 */
export interface BrowserScope {
  sessionId: string
  projectId: string | null
  workspaceRoot: string | null
}

export interface BrowserState {
  status: BrowserStatus
  mode: BrowserControlMode
  headless: boolean
  sessionId: string | null
  url: string | null
  title: string | null
  error: string | null
  attachedAt: number | null
}

export type BrowserLogLevel = 'log' | 'info' | 'warning' | 'error' | 'debug'

export interface BrowserConsoleEntry {
  id: string
  sessionId: string
  ts: number
  level: BrowserLogLevel
  text: string
  source: string
}

export interface BrowserNetworkEntry {
  id: string
  sessionId: string
  ts: number
  method: string
  url: string
  status: number | null
  durationMs: number | null
  failure: string | null
  resourceType: string | null
}

export interface BrowserExceptionEntry {
  id: string
  sessionId: string
  ts: number
  text: string
  stack: string | null
}

/** 一次 CDP 命令的 append-only 审计记录；stepId 关联 Agent 步骤（工具 callId） */
export interface BrowserAuditEntry {
  id: string
  sessionId: string
  ts: number
  method: string
  params: string
  ok: boolean
  error: string | null
  source: 'ai' | 'human'
  stepId: string | null
  /** AI 步骤的自然语言意图，便于人类对照操作日志 */
  intent?: string
}

export type BrowserEvent =
  | { type: 'state'; state: BrowserState }
  | { type: 'console'; entry: BrowserConsoleEntry }
  | { type: 'network'; entry: BrowserNetworkEntry }
  | { type: 'exception'; entry: BrowserExceptionEntry }
  | { type: 'audit'; entry: BrowserAuditEntry }

export const BROWSER_LIMITS = {
  maxUrlLength: 2048,
  maxParamsChars: 4000,
  maxConsoleChars: 2000,
  maxStackChars: 4000,
  maxToolOutputChars: 12 * 1024,
  maxBufferEntries: 500,
  maxAuditQuery: 200,
  commandTimeoutMs: 15_000,
  navigationTimeoutMs: 20_000,
  reconnectBaseMs: 500,
  maxReconnectAttempts: 3,
  /** 截图 data URL 的最大长度（约 3MB 原图），超出则不放进工具结果 */
  maxScreenshotDataUrl: 5 * 1024 * 1024
} as const

/** 观察类原语：不需要人工审批，可并发 */
export const BROWSER_OBSERVE_METHODS = [
  'Page.captureScreenshot',
  'Runtime.evaluate',
  'DOM.getDocument',
  'DOM.querySelector',
  'DOM.querySelectorAll',
  'Accessibility.getFullAXTree',
  'Page.getNavigationHistory'
] as const

/** 操作类原语：默认需要人工审批（manual 档），串行执行 */
export const BROWSER_ACTION_METHODS = [
  'Page.navigate',
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'DOM.focus'
] as const

export const BROWSER_ALLOWED_METHODS = [
  ...BROWSER_OBSERVE_METHODS,
  ...BROWSER_ACTION_METHODS
] as const

export type BrowserCdpMethod = (typeof BROWSER_ALLOWED_METHODS)[number]
export type BrowserObserveMethod = (typeof BROWSER_OBSERVE_METHODS)[number]
export type BrowserActionMethod = (typeof BROWSER_ACTION_METHODS)[number]

export const BROWSER_WAIT_KINDS = ['networkIdle', 'selector', 'expression', 'load'] as const
export type BrowserWaitKind = (typeof BROWSER_WAIT_KINDS)[number]

export function isBrowserCdpMethod(value: string): value is BrowserCdpMethod {
  return (BROWSER_ALLOWED_METHODS as readonly string[]).includes(value)
}

export function isBrowserActionMethod(value: string): boolean {
  return (BROWSER_ACTION_METHODS as readonly string[]).includes(value)
}

export function isBrowserObserveMethod(value: string): boolean {
  return (BROWSER_OBSERVE_METHODS as readonly string[]).includes(value)
}

/** 敏感请求头一律脱敏后再进入事件流 / 审计文件 */
const REDACTED_HEADER_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token'
])

export function redactHeaders(headers: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    result[key] = REDACTED_HEADER_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : String(value ?? '')
  }
  return result
}

/**
 * Runtime.evaluate 的静态护栏。真正的隔离靠 WebContentsView 的
 * sandbox/contextIsolation/nodeIntegration=false + 无 preload；这里再挡一层显式逃逸意图。
 */
const EVAL_DENY_PATTERNS: readonly RegExp[] = [
  /\brequire\s*\(/i,
  /\bprocess\b/i,
  /\b__dirname\b/i,
  /\b__filename\b/i,
  /\bnode:/i,
  /\belectron\b/i,
  /\bimport\s*\(/i,
  /\bFunction\s*\(/i
]

export function isSafeEvaluateExpression(expression: string): boolean {
  return !EVAL_DENY_PATTERNS.some((pattern) => pattern.test(expression))
}

/** 参数摘要：只保留字段名与短值，避免把敏感正文写进审计 */
export function summarizeCdpParams(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params ?? {}).slice(0, 8)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object') {
      parts.push(`${key}={…}`)
      continue
    }
    const text = String(value).replace(/\s+/g, ' ').slice(0, 120)
    parts.push(`${key}=${text}`)
  }
  const joined = parts.join(' ')
  return joined.length > BROWSER_LIMITS.maxParamsChars
    ? `${joined.slice(0, BROWSER_LIMITS.maxParamsChars)}…`
    : joined
}

export function isBrowserWaitKind(value: string): value is BrowserWaitKind {
  return (BROWSER_WAIT_KINDS as readonly string[]).includes(value)
}
