import { randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { WebContentsView, type BrowserWindow } from 'electron'
import {
  BROWSER_LIMITS,
  isSafeEvaluateExpression,
  redactHeaders,
  summarizeCdpParams,
  type BrowserAuditEntry,
  type BrowserConsoleEntry,
  type BrowserControlMode,
  type BrowserEvent,
  type BrowserExceptionEntry,
  type BrowserNetworkEntry,
  type BrowserScope,
  type BrowserState,
  type BrowserStatus,
  type BrowserWaitKind
} from '../../shared/browser'
import type { BrowserSettings } from '../../shared/settings'
import { AppError } from '../../shared/errors'

export interface BrowserServiceDeps {
  /** 主窗口获取器：service 创建早于窗口，必须惰性取值 */
  getWindow: () => BrowserWindow | null
  /** 会话 → 隔离作用域；返回 null 表示会话不存在 */
  resolveScope: (sessionId: string) => BrowserScope | null
  getSettings: () => BrowserSettings
  auditFilePath: string
  emit: (event: BrowserEvent) => void
}

interface PendingCommand {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface NetworkStart {
  method: string
  url: string
  resourceType: string | null
  startedAt: number
}

interface Context {
  scope: BrowserScope
  view: WebContentsView
  status: BrowserStatus
  mode: BrowserControlMode
  url: string | null
  title: string | null
  error: string | null
  attachedAt: number | null
  lastActive: number
  reconnectAttempts: number
  reconnectTimer: NodeJS.Timeout | null
  attached: boolean
  listenerBound: boolean
  nextId: number
  pending: Map<number, PendingCommand>
  networkStarts: Map<string, NetworkStart>
  network: BrowserNetworkEntry[]
  console: BrowserConsoleEntry[]
  exceptions: BrowserExceptionEntry[]
  audit: BrowserAuditEntry[]
  viewport: { x: number; y: number; width: number; height: number } | null
  visible: boolean
  domainsEnabled: boolean
}

function clipText(value: string, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '未知错误')
}

function safeUrl(url: string): string {
  const value = url.trim()
  if (!value) throw new AppError('E_INVALID_INPUT', 'URL 不能为空')
  if (/^(javascript|data|file|chrome|about):/i.test(value)) {
    throw new AppError('E_INVALID_INPUT', '出于安全考虑禁止导航到该协议：只允许 http/https')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new AppError('E_INVALID_INPUT', 'URL 格式不合法')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('E_INVALID_INPUT', '只允许 http/https 页面')
  }
  return parsed.toString()
}

function profilePartition(scope: BrowserScope, settings: BrowserSettings): string | undefined {
  if (settings.inheritProfile) return undefined
  // sessionId 是 UUID，projectId 可能含任意字符：做白名单化避免非法 partition 名
  const project = (scope.projectId ?? 'no-project').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  const session = scope.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  return `persist:yocim-browser-${project}-${session}`
}

function emptyState(context?: Context, settings?: BrowserSettings): BrowserState {
  if (!context) {
    return {
      status: 'idle',
      mode: 'ai',
      headless: settings?.headless ?? false,
      sessionId: null,
      url: null,
      title: null,
      error: null,
      attachedAt: null
    }
  }
  return {
    status: context.status,
    mode: context.mode,
    headless: settings?.headless ?? false,
    sessionId: context.scope.sessionId,
    url: context.url,
    title: context.title,
    error: context.error,
    attachedAt: context.attachedAt
  }
}

/**
 * 受管理的浏览器运行时：每个会话一个 WebContentsView + CDP（webContents.debugger）通道。
 *
 * - 不启动独立浏览器进程，不引入 Playwright/Puppeteer；AI 只通过 CDP 原语操作页面。
 * - 视图在 tab 切换时只隐藏不销毁（keep-alive）；空闲超时才回收。
 * - profile 按会话/项目隔离；显式确认后才复用日常 profile。
 * - 所有事件带 sessionId，渲染层严格按会话过滤。
 */
export class BrowserService {
  private readonly contexts = new Map<string, Context>()
  private readonly auditFileInitialized = new Set<string>()
  private idleTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: BrowserServiceDeps) {}

  start(): void {
    if (!this.idleTimer) {
      this.idleTimer = setInterval(() => this.recycleIdle(), 60_000)
      this.idleTimer.unref?.()
    }
  }

  disposeAll(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    for (const sessionId of [...this.contexts.keys()]) this.dispose(sessionId)
  }

  state(sessionId: string): BrowserState {
    return emptyState(this.contexts.get(sessionId), this.deps.getSettings())
  }

  /** 渲染层上报视图位置；visible=false 时隐藏全部视图（切到终端 tab） */
  viewport(input: {
    sessionId: string
    x: number
    y: number
    width: number
    height: number
    visible: boolean
  }): { applied: boolean } {
    for (const [id, ctx] of this.contexts) {
      const shouldShow = input.visible && id === input.sessionId && !this.deps.getSettings().headless
      ctx.visible = shouldShow
      try {
        ctx.view.setVisible(shouldShow)
      } catch {
        // 视图已从窗口移除时忽略
      }
    }
    if (!input.visible) return { applied: true }

    const context = this.ensure(input.sessionId)
    context.viewport = {
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height
    }
    try {
      context.view.setBounds(context.viewport)
      return { applied: true }
    } catch (error) {
      context.error = `视图定位失败：${errorText(error)}`
      this.emitState(context)
      return { applied: false }
    }
  }

  /** 人类地址栏导航：绕过 AI 审批门控，但仍写入审计 */
  async navigate(sessionId: string, rawUrl: string): Promise<{ url: string }> {
    const url = safeUrl(rawUrl)
    const context = this.ensure(sessionId)
    context.lastActive = Date.now()
    this.appendAudit(context, 'Page.navigate', { url }, true, null, 'human', null)
    try {
      await this.send(context, 'Page.navigate', { url }, BROWSER_LIMITS.navigationTimeoutMs)
      context.url = url
      this.emitState(context)
      return { url }
    } catch (error) {
      this.appendAudit(context, 'Page.navigate', { url }, false, errorText(error), 'human', null)
      throw error
    }
  }

  control(sessionId: string, mode: BrowserControlMode): BrowserState {
    const context = this.ensure(sessionId)
    context.mode = mode
    context.lastActive = Date.now()
    this.emitState(context)
    return emptyState(context, this.deps.getSettings())
  }

  async retry(sessionId: string): Promise<BrowserState> {
    const context = this.contexts.get(sessionId) ?? this.ensure(sessionId)
    if (context.reconnectTimer) {
      clearTimeout(context.reconnectTimer)
      context.reconnectTimer = null
    }
    context.reconnectAttempts = 0
    context.error = null
    context.status = 'connecting'
    this.emitState(context)
    await this.attach(context)
    return emptyState(context, this.deps.getSettings())
  }

  /** 查询某会话最近的 append-only 审计（时间倒序） */
  audit(sessionId: string, limit: number): BrowserAuditEntry[] {
    const context = this.contexts.get(sessionId)
    if (!context) return []
    return [...context.audit].reverse().slice(0, limit)
  }

  /**
   * AI 的 CDP 原语入口。所有调用都经此函数：控制模式门控 + 静态护栏 + 审计 + 超时。
   * source 恒为 'ai'；人类入口走 navigate()。
   */
  async execute(
    sessionId: string,
    method: string,
    params: Record<string, unknown>,
    stepId: string | null,
    intent: string,
    signal: AbortSignal
  ): Promise<Record<string, unknown>> {
    const context = this.ensure(sessionId)
    context.lastActive = Date.now()

    if (context.mode !== 'ai') {
      const message =
        context.mode === 'paused'
          ? 'AI 操作已暂停，请等待人类恢复'
          : '人类已接管浏览器，AI 指令已被拒绝'
      this.appendAudit(context, method, params, false, message, 'ai', stepId)
      throw new AppError('E_BROWSER_TAKEOVER', message)
    }

    if (method === 'Runtime.evaluate') {
      if (!this.deps.getSettings().allowEvaluate) {
        const message = 'Runtime.evaluate 已在浏览器设置中关闭'
        this.appendAudit(context, method, params, false, message, 'ai', stepId)
        throw new AppError('E_FORBIDDEN', message)
      }
      const expression = typeof params['expression'] === 'string' ? params['expression'] : ''
      if (!expression || expression.length > 4000 || !isSafeEvaluateExpression(expression)) {
        const message = '表达式为空、过长或命中原生 API 黑名单（禁止访问 Node/Electron/文件系统）'
        this.appendAudit(context, method, params, false, message, 'ai', stepId)
        throw new AppError('E_FORBIDDEN', message)
      }
    }

    if (signal.aborted) {
      throw new AppError('E_BROWSER_TIMEOUT', '操作已取消')
    }

    try {
      const result = await this.send(context, method, params, BROWSER_LIMITS.commandTimeoutMs, signal)
      this.appendAudit(context, method, params, true, null, 'ai', stepId, intent)
      return result
    } catch (error) {
      const message = errorText(error)
      this.appendAudit(context, method, params, false, message, 'ai', stepId, intent)
      throw error
    }
  }

  /** browser_wait 的等待语义：全部基于 CDP 状态轮询/事件，不做固定 sleep 式盲等 */
  async wait(
    sessionId: string,
    kind: BrowserWaitKind,
    value: string,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<string> {
    const context = this.ensure(sessionId)
    context.lastActive = Date.now()
    if (context.mode !== 'ai') {
      throw new AppError('E_BROWSER_TAKEOVER', '人类已暂停/接管浏览器，等待指令被拒绝')
    }

    const deadline = Date.now() + timeoutMs
    const poll = async (): Promise<boolean> => {
      const result = await this.send(context, 'Runtime.evaluate', {
        expression: this.waitExpression(kind, value),
        returnByValue: true,
        awaitPromise: true,
        userGesture: false,
        includeCommandLineAPI: false
      }, timeoutMs)
      const nested = result['result'] as Record<string, unknown> | undefined
      return nested?.['value'] === true
    }

    try {
      while (Date.now() < deadline) {
        if (signal.aborted) throw new AppError('E_BROWSER_TIMEOUT', '等待已取消')
        if (kind === 'networkIdle') {
          if (this.isNetworkIdle(context)) return '网络已静默'
        } else if (await poll()) {
          return `条件已满足：${kind}`
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 120))
      }
      throw new AppError('E_BROWSER_TIMEOUT', `等待 ${kind} 超时（${timeoutMs}ms）`)
    } catch (error) {
      this.appendAudit(
        context,
        `browser.wait:${kind}`,
        { value },
        false,
        errorText(error),
        'ai',
        null
      )
      throw error
    }
  }

  private waitExpression(kind: BrowserWaitKind, value: string): string {
    switch (kind) {
      case 'load':
        return 'document.readyState === "complete"'
      case 'selector': {
        const escaped = JSON.stringify(value.slice(0, 500))
        return `!!document.querySelector(${escaped})`
      }
      case 'expression':
        return !value ? 'false' : `Boolean(${value.slice(0, 1000)})`
      case 'networkIdle':
        return 'document.readyState === "complete"'
    }
  }

  private isNetworkIdle(context: Context): boolean {
    if (context.networkStarts.size > 0) return false
    const last = context.network[0]
    if (!last) return true
    return Date.now() - last.ts >= 500
  }

  private ensure(sessionId: string): Context {
    const existing = this.contexts.get(sessionId)
    if (existing) return existing

    const scope = this.deps.resolveScope(sessionId)
    if (!scope) throw new AppError('E_BROWSER_UNAVAILABLE', '会话不存在，无法创建浏览器上下文')

    const settings = this.deps.getSettings()
    if (!settings.enabled) {
      throw new AppError('E_BROWSER_UNAVAILABLE', '浏览器能力已在设置中关闭')
    }

    const view = new WebContentsView({
      webPreferences: {
        partition: profilePartition(scope, settings),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false
      }
    })
    view.setBackgroundColor('#ffffff')

    const context: Context = {
      scope,
      view,
      status: 'idle',
      mode: 'ai',
      url: null,
      title: null,
      error: null,
      attachedAt: null,
      lastActive: Date.now(),
      reconnectAttempts: 0,
      reconnectTimer: null,
      attached: false,
      listenerBound: false,
      nextId: 1,
      pending: new Map(),
      networkStarts: new Map(),
      network: [],
      console: [],
      exceptions: [],
      audit: [],
      viewport: null,
      visible: false,
      domainsEnabled: false
    }
    this.contexts.set(sessionId, context)

    const window = this.deps.getWindow()
    if (window && !window.isDestroyed()) {
      window.contentView.addChildView(view)
      view.setVisible(false)
    }

    this.bindWebContents(context)
    context.status = 'connecting'
    this.emitState(context)
    void this.attach(context)
    return context
  }

  private bindWebContents(context: Context): void {
    if (context.listenerBound) return
    context.listenerBound = true
    const contents = context.view.webContents

    contents.on('render-process-gone', (_event, details) =>
      this.onCrash(context, `渲染进程退出：${details.reason}`)
    )
    contents.on('did-fail-load', (_event, code, description) => {
      if (code === -3) return // ERR_ABORTED，导航被新请求取代
      const message = `页面加载失败（${code}）：${description}`
      context.error = message
      this.pushConsole(context, 'error', message, 'browser')
      this.emitState(context)
    })
    contents.on('did-finish-load', () => {
      context.error = null
      this.emitState(context)
    })

    const debuggerInstance = contents.debugger
    debuggerInstance.on('message', (_event, method: string, params: unknown) => {
      this.handleCdpEvent(context, method, (params ?? {}) as Record<string, unknown>)
    })
    debuggerInstance.on('detach', (_event, reason: string) => {
      context.attached = false
      context.domainsEnabled = false
      for (const pending of context.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new AppError('E_BROWSER_UNAVAILABLE', `CDP 连接断开：${reason}`))
      }
      context.pending.clear()
      if (context.status !== 'disposed') {
        context.status = 'reconnecting'
        this.emitState(context)
        this.scheduleReconnect(context)
      }
    })
  }

  private onCrash(context: Context, message: string): void {
    if (context.status === 'disposed') return
    context.status = 'error'
    context.error = message
    context.attached = false
    this.pushException(context, message, null)
    this.emitState(context)
    this.scheduleReconnect(context)
  }

  private scheduleReconnect(context: Context): void {
    if (context.reconnectTimer) return
    if (context.reconnectAttempts >= BROWSER_LIMITS.maxReconnectAttempts) {
      context.status = 'error'
      context.error = `${context.error ?? 'CDP 连接中断'}，自动重连 ${context.reconnectAttempts} 次后停止`
      this.emitState(context)
      return
    }
    context.reconnectAttempts += 1
    const delay = BROWSER_LIMITS.reconnectBaseMs * 2 ** (context.reconnectAttempts - 1)
    context.reconnectTimer = setTimeout(() => {
      context.reconnectTimer = null
      void this.attach(context)
    }, delay)
    context.reconnectTimer.unref?.()
  }

  private async attach(context: Context): Promise<void> {
    if (context.status === 'disposed') return
    const debuggerInstance = context.view.webContents.debugger
    try {
      // 空 WebContentsView 没有 document，Runtime.enable 等命令会永不 resolve。
      // 先落地一个 about:blank，再附加调试器（Electron/CDP 的已知行为）。
      if (context.view.webContents.getURL() === '') {
        await context.view.webContents.loadURL('about:blank')
      }
      if (!debuggerInstance.isAttached()) debuggerInstance.attach('1.3')
      context.attached = true
      if (!context.domainsEnabled) {
        for (const domain of ['Runtime.enable', 'Log.enable', 'Network.enable', 'Page.enable']) {
          await debuggerInstance.sendCommand(domain)
        }
        context.domainsEnabled = true
      }
      context.status = 'ready'
      context.attachedAt = Date.now()
      context.error = null
      context.reconnectAttempts = 0
      this.emitState(context)
    } catch (error) {
      context.status = 'error'
      context.error = `CDP 连接失败：${errorText(error)}`
      this.emitState(context)
      this.scheduleReconnect(context)
      throw new AppError('E_BROWSER_UNAVAILABLE', context.error)
    }
  }

  private send(
    context: Context,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    if (!context.attached || !context.domainsEnabled) {
      return Promise.reject(
        new AppError('E_BROWSER_UNAVAILABLE', 'CDP 尚未连接，请稍后重试或点击重试')
      )
    }
    const id = context.nextId++
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        context.pending.delete(id)
        reject(new AppError('E_BROWSER_TIMEOUT', `CDP 命令 ${method} 超时（${timeoutMs}ms）`))
      }, timeoutMs)
      const onAbort = (): void => {
        context.pending.delete(id)
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(new AppError('E_BROWSER_TIMEOUT', `CDP 命令 ${method} 已取消`))
      }
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer)
          reject(new AppError('E_BROWSER_TIMEOUT', `CDP 命令 ${method} 已取消`))
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      context.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
        timer
      })
      context.view.webContents.debugger
        .sendCommand(method, params)
        .then((result) => {
          const pending = context.pending.get(id)
          if (pending) {
            context.pending.delete(id)
            pending.resolve((result ?? {}) as Record<string, unknown>)
          }
        })
        .catch((error: unknown) => {
          const pending = context.pending.get(id)
          if (pending) {
            context.pending.delete(id)
            pending.reject(
              new AppError('E_BROWSER_UNAVAILABLE', `CDP 命令 ${method} 失败：${errorText(error)}`)
            )
          }
        })
    })
  }

  private handleCdpEvent(
    context: Context,
    method: string,
    params: Record<string, unknown>
  ): void {
    switch (method) {
      case 'Runtime.consoleAPICalled': {
        const type = String(params['type'] ?? 'log')
        const args = Array.isArray(params['args']) ? (params['args'] as Record<string, unknown>[]) : []
        const text = args
          .map((arg) =>
            typeof arg['value'] === 'string'
              ? arg['value']
              : typeof arg['description'] === 'string'
                ? arg['description']
                : String(arg['value'] ?? '')
          )
          .join(' ')
        this.pushConsole(context, this.consoleLevel(type), clipText(text, BROWSER_LIMITS.maxConsoleChars), 'page')
        break
      }
      case 'Log.entryAdded': {
        const entry = (params['entry'] ?? {}) as Record<string, unknown>
        this.pushConsole(
          context,
          this.consoleLevel(String(entry['level'] ?? 'log')),
          clipText(String(entry['text'] ?? ''), BROWSER_LIMITS.maxConsoleChars),
          typeof entry['url'] === 'string' ? entry['url'] : 'browser'
        )
        break
      }
      case 'Runtime.exceptionThrown': {
        const details = (params['exceptionDetails'] ?? {}) as Record<string, unknown>
        const exception = (details['exception'] ?? {}) as Record<string, unknown>
        const text = clipText(
          String(details['text'] ?? exception['description'] ?? '未处理异常'),
          BROWSER_LIMITS.maxConsoleChars
        )
        const stack = typeof exception['description'] === 'string' ? exception['description'] : null
        this.pushException(context, text, stack ? clipText(stack, BROWSER_LIMITS.maxStackChars) : null)
        break
      }
      case 'Network.requestWillBeSent': {
        const request = (params['request'] ?? {}) as Record<string, unknown>
        const requestId = String(params['requestId'] ?? '')
        if (!requestId) break
        context.networkStarts.set(requestId, {
          method: String(request['method'] ?? 'GET'),
          url: String(request['url'] ?? ''),
          resourceType: typeof params['type'] === 'string' ? params['type'] : null,
          startedAt: Date.now()
        })
        break
      }
      case 'Network.responseReceived': {
        const requestId = String(params['requestId'] ?? '')
        const response = (params['response'] ?? {}) as Record<string, unknown>
        const headers = redactHeaders((response['headers'] ?? {}) as Record<string, unknown>)
        void headers // 敏感头已脱敏，不进入事件流
        this.finishNetwork(context, requestId, Number(response['status'] ?? 0), null)
        break
      }
      case 'Network.loadingFailed': {
        const requestId = String(params['requestId'] ?? '')
        this.finishNetwork(
          context,
          requestId,
          null,
          clipText(String(params['errorText'] ?? '请求失败'), 200)
        )
        break
      }
      case 'Page.frameNavigated': {
        const frame = (params['frame'] ?? {}) as Record<string, unknown>
        if (frame['parentId'] === undefined) {
          context.url = typeof frame['url'] === 'string' ? frame['url'] : context.url
          this.emitState(context)
        }
        break
      }
      case 'Page.loadEventFired': {
        void this.send(context, 'Runtime.evaluate', {
          expression: 'document.title',
          returnByValue: true,
          awaitPromise: false,
          userGesture: false,
          includeCommandLineAPI: false
        }, BROWSER_LIMITS.commandTimeoutMs)
          .then((result) => {
            const nested = result['result'] as Record<string, unknown> | undefined
            if (typeof nested?.['value'] === 'string') {
              context.title = nested['value'] as string
              this.emitState(context)
            }
          })
          .catch(() => undefined)
        break
      }
      case 'Inspector.targetCrashed':
        this.onCrash(context, 'CDP target 崩溃')
        break
      default:
        break
    }
  }

  private finishNetwork(
    context: Context,
    requestId: string,
    status: number | null,
    failure: string | null
  ): void {
    const start = context.networkStarts.get(requestId)
    if (!start) return
    context.networkStarts.delete(requestId)
    const entry: BrowserNetworkEntry = {
      id: randomUUID(),
      sessionId: context.scope.sessionId,
      ts: Date.now(),
      method: start.method,
      url: clipText(start.url, BROWSER_LIMITS.maxConsoleChars),
      status,
      durationMs: Math.max(0, Date.now() - start.startedAt),
      failure,
      resourceType: start.resourceType
    }
    context.network.unshift(entry)
    if (context.network.length > BROWSER_LIMITS.maxBufferEntries) {
      context.network.length = BROWSER_LIMITS.maxBufferEntries
    }
    this.deps.emit({ type: 'network', entry })
  }

  private consoleLevel(type: string): BrowserConsoleEntry['level'] {
    if (type === 'warning' || type === 'warn') return 'warning'
    if (type === 'error') return 'error'
    if (type === 'info') return 'info'
    if (type === 'debug' || type === 'verbose') return 'debug'
    return 'log'
  }

  private pushConsole(
    context: Context,
    level: BrowserConsoleEntry['level'],
    text: string,
    source: string
  ): void {
    const entry: BrowserConsoleEntry = {
      id: randomUUID(),
      sessionId: context.scope.sessionId,
      ts: Date.now(),
      level,
      text,
      source: clipText(source, 300)
    }
    context.console.unshift(entry)
    if (context.console.length > BROWSER_LIMITS.maxBufferEntries) {
      context.console.length = BROWSER_LIMITS.maxBufferEntries
    }
    this.deps.emit({ type: 'console', entry })
  }

  private pushException(context: Context, text: string, stack: string | null): void {
    const entry: BrowserExceptionEntry = {
      id: randomUUID(),
      sessionId: context.scope.sessionId,
      ts: Date.now(),
      text,
      stack
    }
    context.exceptions.unshift(entry)
    if (context.exceptions.length > BROWSER_LIMITS.maxBufferEntries) {
      context.exceptions.length = BROWSER_LIMITS.maxBufferEntries
    }
    this.deps.emit({ type: 'exception', entry })
  }

  private appendAudit(
    context: Context,
    method: string,
    params: Record<string, unknown>,
    ok: boolean,
    error: string | null,
    source: 'ai' | 'human',
    stepId: string | null,
    intent?: string
  ): void {
    const entry: BrowserAuditEntry = {
      id: randomUUID(),
      sessionId: context.scope.sessionId,
      ts: Date.now(),
      method,
      params: clipText(summarizeCdpParams(params), BROWSER_LIMITS.maxParamsChars),
      ok,
      error,
      source,
      stepId,
      intent: intent ? clipText(intent, 300) : undefined
    }
    context.audit.unshift(entry)
    if (context.audit.length > BROWSER_LIMITS.maxBufferEntries) {
      context.audit.length = BROWSER_LIMITS.maxBufferEntries
    }
    this.deps.emit({ type: 'audit', entry })
    void this.appendAuditFile(entry, intent)
  }

  private async appendAuditFile(entry: BrowserAuditEntry, intent?: string): Promise<void> {
    const path = this.deps.auditFilePath
    try {
      if (!this.auditFileInitialized.has(path)) {
        await mkdir(dirname(path), { recursive: true })
        this.auditFileInitialized.add(path)
      }
      await appendFile(path, `${JSON.stringify({ ...entry, intent: intent ?? '' })}\n`, 'utf8')
    } catch {
      // 审计文件写入失败不能阻断操作；内存环形缓冲仍保留最近记录
    }
  }

  private emitState(context: Context): void {
    this.deps.emit({ type: 'state', state: emptyState(context, this.deps.getSettings()) })
  }

  private recycleIdle(): void {
    const minutes = this.deps.getSettings().idleRecycleMinutes
    if (minutes <= 0) return
    const threshold = minutes * 60_000
    const now = Date.now()
    for (const [sessionId, context] of this.contexts) {
      if (context.visible || context.mode !== 'ai' || context.pending.size > 0) continue
      if (now - context.lastActive < threshold) continue
      this.appendAudit(context, 'browser.dispose', {}, true, null, 'human', null)
      this.dispose(sessionId)
    }
  }

  private dispose(sessionId: string): void {
    const context = this.contexts.get(sessionId)
    if (!context) return
    context.status = 'disposed'
    if (context.reconnectTimer) {
      clearTimeout(context.reconnectTimer)
      context.reconnectTimer = null
    }
    for (const pending of context.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new AppError('E_BROWSER_UNAVAILABLE', '浏览器上下文已回收'))
    }
    context.pending.clear()
    try {
      if (context.view.webContents.debugger.isAttached()) {
        context.view.webContents.debugger.detach()
      }
    } catch {
      // 忽略：进程可能已退出
    }
    try {
      const window = this.deps.getWindow()
      if (window && !window.isDestroyed()) window.contentView.removeChildView(context.view)
    } catch {
      // 忽略：窗口可能已销毁
    }
    this.contexts.delete(sessionId)
  }
}

export { safeUrl as validateBrowserUrl }
