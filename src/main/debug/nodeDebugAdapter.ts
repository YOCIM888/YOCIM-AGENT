import { spawn, type ChildProcess } from 'node:child_process'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AppError } from '../../shared/errors'
import { DEBUG_LIMITS } from '../../shared/ipcChannels'
import type {
  DebugBreakpoint,
  DebugEvaluation,
  DebugPausedInfo,
  DebugScope,
  DebugStackFrame,
  DebugVariable
} from '../../shared/debug'
import { CdpClient } from './cdpClient'
import type { LaunchPlan } from './launchConfig'
import { stripAnsi } from '../util/ansi'

interface RemoteObject {
  type?: string
  subtype?: string
  className?: string
  description?: string
  value?: unknown
  unserializableValue?: string
  objectId?: string
}

interface CallFramePayload {
  callFrameId: string
  functionName?: string
  url?: string
  location?: { scriptId?: string; lineNumber: number; columnNumber: number }
  scopeChain?: Array<{ type: string; name?: string; object: RemoteObject }>
}

interface PausedPayload {
  reason: string
  description?: string
  hitBreakpoints?: string[]
  callFrames: CallFramePayload[]
}

interface PropertyDescriptor {
  name: string
  value?: RemoteObject
  get?: RemoteObject
  set?: RemoteObject
}

const DEBUGGER_BANNER =
  /^(Debugger listening on|For help, see:|Debugger attached\.|Waiting for the debugger to disconnect)/

const SCOPE_LABELS: Record<string, string> = {
  local: '局部',
  closure: '闭包',
  global: '全局',
  block: '块',
  script: '脚本',
  catch: '异常',
  module: '模块',
  eval: '求值',
  with: 'with'
}

/** 把 CDP 的脚本 url 映射成工作区相对路径；工作区外返回 null */
export function relativePathForUrl(root: string, url: string): string | null {
  if (!url) return null
  let absolute: string
  try {
    if (url.startsWith('file://')) {
      absolute = fileURLToPath(url)
    } else if (isAbsolute(url)) {
      absolute = url
    } else {
      return null
    }
  } catch {
    return null
  }
  const normalizedRoot = resolve(root)
  const normalized = resolve(absolute)
  if (normalized === normalizedRoot) return ''
  if (!normalized.startsWith(normalizedRoot + sep)) return null
  return normalized
    .slice(normalizedRoot.length + 1)
    .split(sep)
    .join('/')
}

function formatRemoteObject(value: RemoteObject | undefined): {
  text: string
  type?: string
  reference: string | null
} {
  if (!value) return { text: 'undefined', reference: null }
  const type = value.subtype ? `${value.type}/${value.subtype}` : value.type
  if (value.type === 'string') {
    return { text: JSON.stringify(value.value ?? ''), type, reference: null }
  }
  if (value.type === 'undefined') return { text: 'undefined', type, reference: null }
  if (value.unserializableValue) {
    return { text: value.unserializableValue, type, reference: null }
  }
  if (value.type === 'function') {
    const first = (value.description ?? '').split('\n')[0] ?? 'function'
    return { text: first.slice(0, 200), type, reference: value.objectId ?? null }
  }
  if (value.type === 'object') {
    const text = value.description ?? (value.subtype === 'null' ? 'null' : 'Object')
    return {
      text: text.length > 300 ? `${text.slice(0, 300)}…` : text,
      type,
      reference: value.objectId ?? null
    }
  }
  return {
    text: value.value === undefined ? (value.description ?? String(type)) : String(value.value),
    type,
    reference: null
  }
}

export interface NodeAdapterOptions {
  root: string
  plan: LaunchPlan
  stopOnEntry: boolean
  onOutput: (category: 'stdout' | 'stderr' | 'console', text: string) => void
  onPaused: (info: DebugPausedInfo) => void
  onResumed: () => void
  onExit: (code: number | null, message?: string) => void
  onBreakpoints: (breakpoints: DebugBreakpoint[]) => void
  spawnImpl?: typeof spawn
  attachTimeoutMs?: number
}

/**
 * Node.js 调试适配器：`node --inspect-brk` + CDP。
 * 断点用 `Debugger.setBreakpointByUrl`（file:// URL），变量走 `Runtime.getProperties`，
 * 求值走 `Debugger.evaluateOnCallFrame`。
 */
export class NodeDebugAdapter {
  private readonly options: NodeAdapterOptions
  private child: ChildProcess | null = null
  private cdp: CdpClient | null = null
  private stopping = false
  private initialPauseHandled = false
  private readonly breakpoints: DebugBreakpoint[] = []
  /** CDP breakpointId → 前端断点 id */
  private readonly cdpBreakpoints = new Map<string, string>()
  /** callFrameId → scopeChain（CDP 只在暂停事件里给全量作用域） */
  private readonly frameScopes = new Map<string, CallFramePayload['scopeChain']>()
  /** scriptId → 脚本 url：断点暂停时 CDP 的 callFrame.url 可能为空，需回查 */
  private readonly scriptUrls = new Map<string, string>()
  private exitNotified = false

  constructor(options: NodeAdapterOptions) {
    this.options = options
  }

  async start(): Promise<void> {
    const { plan } = this.options
    const spawnImpl = this.options.spawnImpl ?? spawn
    const args = ['--inspect-brk=127.0.0.1:0', ...plan.runtimeArgs, plan.program, ...plan.args]

    const child = spawnImpl(process.execPath, args, {
      cwd: plan.cwd,
      // 应用运行在 Electron 主进程时，process.execPath 是 electron.exe：
      // 必须用 ELECTRON_RUN_AS_NODE 让它以 Node 身份执行调试目标，
      // 否则会被当作 Electron 应用入口启动，进程不会按脚本结束。
      env: { ...process.env, ...plan.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child

    const wsUrl = await this.waitForDebuggerUrl(child, this.options.attachTimeoutMs ?? 15_000)

    const cdp = await CdpClient.connect(wsUrl, DEBUG_LIMITS.requestTimeoutMs)
    this.cdp = cdp
    cdp.onEvent((method, params) => this.handleEvent(method, params))

    child.on('exit', (code) => this.notifyExit(code ?? null))
    child.on('error', (error) => this.notifyExit(null, error.message))

    await cdp.send('Runtime.enable')
    await cdp.send('Debugger.enable')
    await this.applyBreakpoints()

    cdp.send('Runtime.runIfWaitingForDebugger').catch(() => {
      // 进程可能已经退出
    })
  }

  /** 面板输出区是纯文本，先剔除 ANSI 颜色码再交给上层 */
  private emitOutput(stream: 'stdout' | 'stderr' | 'console', text: string): void {
    const clean = stripAnsi(text)
    if (clean) this.options.onOutput(stream, clean)
  }

  /** 等待 stderr 中的 `Debugger listening on ws://...` 并转发其余输出 */
  private waitForDebuggerUrl(child: ChildProcess, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolvePromise, reject) => {
      let buffer = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new AppError('E_UNKNOWN', '调试器启动超时，请检查启动配置或 Node 版本'))
      }, timeoutMs)

      const finish = (url: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise(url)
      }

      const forward = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        const lines = `${buffer}${text}`.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (DEBUGGER_BANNER.test(line.trim())) continue
          this.emitOutput(stream, `${line}\n`)
        }
      }

      child.stdout?.on('data', (chunk: Buffer) => forward('stdout', chunk))
      child.stderr?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const match = /ws:\/\/[^\s]+/.exec(buffer)
        if (match && !settled) {
          // 已解析到地址：把 banner 之前的内容当普通输出处理
          const before = buffer.slice(0, match.index)
          for (const line of before.split(/\r?\n/)) {
            if (line.trim() && !DEBUGGER_BANNER.test(line.trim())) {
              this.emitOutput('stderr', `${line}\n`)
            }
          }
          buffer = buffer.slice(match.index + match[0].length)
          finish(match[0])
          return
        }
        if (buffer.length > 64 * 1024) {
          const keep = buffer.slice(-8 * 1024)
          this.emitOutput('stderr', buffer.slice(0, buffer.length - 8 * 1024))
          buffer = keep
        }
      })

      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new AppError('E_UNKNOWN', `无法启动 Node 进程：${error.message}`))
      })
      child.on('exit', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new AppError('E_UNKNOWN', `Node 进程已退出（code ${code ?? 'null'}），未连接调试器`))
      })
    })
  }

  private handleEvent(method: string, params: Record<string, unknown>): void {
    if (method === 'Debugger.scriptParsed') {
      const scriptId = String(params['scriptId'] ?? '')
      const url = typeof params['url'] === 'string' ? params['url'] : ''
      if (scriptId && url) this.scriptUrls.set(scriptId, url)
      return
    }

    if (method === 'Runtime.executionContextDestroyed') {
      // 进程已结束但 Node 会等待调试器断开，这里主动关闭连接让 child 正常退出
      this.cdp?.close()
      this.cdp = null
      return
    }

    if (method === 'Debugger.paused') {
      const payload = params as unknown as PausedPayload
      this.frameScopes.clear()
      for (const frame of payload.callFrames ?? []) {
        this.frameScopes.set(frame.callFrameId, frame.scopeChain)
      }

      if (!this.initialPauseHandled) {
        this.initialPauseHandled = true
        if (!this.options.stopOnEntry) {
          this.cdp?.send('Debugger.resume').catch(() => undefined)
          this.options.onResumed()
          return
        }
      }

      this.options.onPaused(this.toPausedInfo(payload))
      return
    }

    if (method === 'Debugger.resumed') {
      this.frameScopes.clear()
      this.options.onResumed()
      return
    }

    if (method === 'Debugger.breakpointResolved') {
      const breakpointId = String(params['breakpointId'] ?? '')
      const id = this.cdpBreakpoints.get(breakpointId)
      if (!id) return
      const bp = this.breakpoints.find((item) => item.id === id)
      if (bp && !bp.verified) {
        bp.verified = true
        this.options.onBreakpoints([...this.breakpoints])
      }
      return
    }

    if (method === 'Runtime.exceptionThrown') {
      const details = params['exceptionDetails'] as
        { text?: string; exception?: { description?: string } } | undefined
      const text = details?.exception?.description ?? details?.text ?? '运行时代码抛出了未捕获异常'
      this.emitOutput('console', `${text.split('\n')[0]}\n`)
    }
  }

  private toPausedInfo(payload: PausedPayload): DebugPausedInfo {
    const frames: DebugStackFrame[] = (payload.callFrames ?? []).map((frame, index) => {
      // 命中断点时 Node 给的是 url: ''，只能靠 location.scriptId 回查
      const url =
        frame.url ||
        (frame.location?.scriptId ? (this.scriptUrls.get(frame.location.scriptId) ?? '') : '')
      return {
        id: frame.callFrameId,
        index,
        name: frame.functionName || '(匿名函数)',
        relativePath: relativePathForUrl(this.options.root, url),
        line: frame.location ? frame.location.lineNumber + 1 : null,
        column: frame.location ? frame.location.columnNumber + 1 : null,
        url
      }
    })
    const hitBreakpointIds = (payload.hitBreakpoints ?? [])
      .map((id) => this.cdpBreakpoints.get(id))
      .filter((id): id is string => Boolean(id))
    return {
      reason: payload.reason,
      ...(payload.description ? { description: payload.description } : {}),
      frames,
      hitBreakpointIds
    }
  }

  private async applyBreakpoints(): Promise<void> {
    const cdp = this.cdp
    if (!cdp) return
    for (const breakpointId of this.cdpBreakpoints.keys()) {
      await cdp.send('Debugger.removeBreakpoint', { breakpointId }).catch(() => undefined)
    }
    this.cdpBreakpoints.clear()

    for (const bp of this.breakpoints) {
      if (!bp.enabled) {
        bp.verified = false
        continue
      }
      const absolute = join(this.options.root, bp.relativePath)
      const url = pathToFileURL(absolute).href
      try {
        const result = await cdp.send<{
          breakpointId: string
          locations?: Array<{ lineNumber: number }>
        }>('Debugger.setBreakpointByUrl', {
          lineNumber: Math.max(0, bp.line - 1),
          url,
          ...(bp.condition ? { condition: bp.condition } : {})
        })
        this.cdpBreakpoints.set(result.breakpointId, bp.id)
        bp.verified = Array.isArray(result.locations) && result.locations.length > 0
      } catch {
        bp.verified = false
      }
    }
    this.options.onBreakpoints([...this.breakpoints])
  }

  async setBreakpoints(breakpoints: DebugBreakpoint[]): Promise<DebugBreakpoint[]> {
    this.breakpoints.length = 0
    this.breakpoints.push(...breakpoints.map((bp) => ({ ...bp })))
    if (!this.cdp) return [...this.breakpoints]
    await this.applyBreakpoints()
    return [...this.breakpoints]
  }

  async command(
    command: 'continue' | 'pause' | 'stepOver' | 'stepInto' | 'stepOut'
  ): Promise<void> {
    const cdp = this.requireCdp()
    switch (command) {
      case 'continue':
        await cdp.send('Debugger.resume')
        return
      case 'pause':
        await cdp.send('Debugger.pause')
        return
      case 'stepOver':
        await cdp.send('Debugger.stepOver')
        return
      case 'stepInto':
        await cdp.send('Debugger.stepInto')
        return
      case 'stepOut':
        await cdp.send('Debugger.stepOut')
        return
    }
  }

  async scopes(frameId: string): Promise<DebugScope[]> {
    const chain = this.frameScopes.get(frameId)
    if (!chain) throw new AppError('E_NOT_FOUND', '当前没有暂停的调用栈，请先命中断点')
    return chain
      .filter((scope) => Boolean(scope.object?.objectId))
      .map((scope, index) => ({
        name: SCOPE_LABELS[scope.type] ?? scope.name ?? scope.type ?? `作用域 ${index + 1}`,
        type: scope.type,
        variablesReference: scope.object.objectId ?? '',
        expensive: scope.type === 'global'
      }))
  }

  async variables(variablesReference: string): Promise<DebugVariable[]> {
    const cdp = this.requireCdp()
    const result = await cdp.send<{ result: PropertyDescriptor[] }>('Runtime.getProperties', {
      objectId: variablesReference,
      ownProperties: true,
      generatePreview: false
    })

    return (result.result ?? [])
      .filter((item) => !item.name.startsWith('[[') && item.name !== '__proto__')
      .slice(0, 500)
      .map((item) => {
        const value = item.value ?? item.get
        const formatted = formatRemoteObject(value)
        return {
          name: item.name,
          value: item.get && !item.value ? '（getter）' : formatted.text,
          ...(formatted.type ? { type: formatted.type } : {}),
          variablesReference: formatted.reference
        }
      })
  }

  async evaluate(input: { expression: string; frameId?: string }): Promise<DebugEvaluation> {
    const cdp = this.requireCdp()
    try {
      const result = input.frameId
        ? await cdp.send<{ result: RemoteObject; exceptionDetails?: { text?: string } }>(
            'Debugger.evaluateOnCallFrame',
            {
              callFrameId: input.frameId,
              expression: input.expression,
              silent: true,
              generatePreview: true
            }
          )
        : await cdp.send<{ result: RemoteObject; exceptionDetails?: { text?: string } }>(
            'Runtime.evaluate',
            { expression: input.expression, silent: true, generatePreview: true }
          )

      if (result.exceptionDetails) {
        return {
          value: result.exceptionDetails.text ?? '求值失败',
          variablesReference: null,
          error: result.exceptionDetails.text ?? '求值失败'
        }
      }
      const formatted = formatRemoteObject(result.result)
      return {
        value: formatted.text,
        ...(formatted.type ? { type: formatted.type } : {}),
        variablesReference: formatted.reference
      }
    } catch (error) {
      return {
        value: error instanceof Error ? error.message : '求值失败',
        variablesReference: null,
        error: error instanceof Error ? error.message : '求值失败'
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    const cdp = this.cdp
    this.cdp = null
    if (cdp) {
      await cdp.send('Debugger.disable').catch(() => undefined)
      cdp.close()
    }
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return
    const pid = child.pid
    if (process.platform === 'win32' && pid) {
      try {
        const killer = (this.options.spawnImpl ?? spawn)(
          'taskkill',
          ['/pid', String(pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' }
        )
        killer.on('error', () => child.kill())
        return
      } catch {
        // 退回 child.kill
      }
    }
    child.kill()
  }

  private requireCdp(): CdpClient {
    if (!this.cdp) throw new AppError('E_UNKNOWN', '调试会话未启动或已结束')
    return this.cdp
  }

  private notifyExit(code: number | null, message?: string): void {
    if (this.exitNotified || this.stopping) return
    this.exitNotified = true
    this.cdp?.close()
    this.cdp = null
    this.options.onExit(code, message)
  }
}
