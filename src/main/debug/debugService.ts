import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { AppError } from '../../shared/errors'
import type {
  DebugBreakpoint,
  DebugCommand,
  DebugConfigFile,
  DebugEvaluation,
  DebugEvent,
  DebugScope,
  DebugSession,
  DebugVariable
} from '../../shared/debug'
import { buildLaunchPlan, readLaunchConfigs } from './launchConfig'
import { NodeDebugAdapter } from './nodeDebugAdapter'

export interface DebugServiceOptions {
  getRoot: () => string | null
  emit: (event: DebugEvent) => void
  /**
   * 启动前的审批钩子。调试入口直接 spawn node 并注入 ELECTRON_RUN_AS_NODE，
   * 必须和 run_command 一样经过人工确认，否则恶意仓库自带的 launch.json
   * 可在用户点「开始调试」时执行任意代码。
   */
  authorize?: (commandLine: string) => Promise<boolean>
  /** 便于单元测试注入 spawn */
  spawnImpl?: typeof import('node:child_process').spawn
  attachTimeoutMs?: number
}

interface StartInput {
  configId: string
  activeFile?: string
  breakpoints: DebugBreakpoint[]
}

export class DebugService {
  private readonly options: DebugServiceOptions
  private adapter: NodeDebugAdapter | null = null
  private session: DebugSession | null = null
  private breakpoints: DebugBreakpoint[] = []
  private lastStart: StartInput | null = null
  private starting = false

  constructor(options: DebugServiceOptions) {
    this.options = options
  }

  async configs(): Promise<DebugConfigFile> {
    const root = this.options.getRoot()
    if (!root) {
      return { path: null, configs: [], error: '未打开工作区，无法读取启动配置' }
    }
    const file = await readLaunchConfigs(root)
    if (!file.configs.length && !file.error) {
      return {
        ...file,
        error:
          file.path === null
            ? '未找到 .yocim/launch.json；可在 package.json 配置 main 字段，或新建 launch.json'
            : 'launch.json 中没有可用的 Node.js 配置（type 需为 "node" 且包含 program）'
      }
    }
    return file
  }

  currentSession(): DebugSession | null {
    return this.session
  }

  async start(input: StartInput): Promise<DebugSession> {
    const root = this.options.getRoot()
    if (!root) throw new AppError('E_NO_WORKSPACE', '未打开工作区，无法启动调试')
    if (this.session && this.session.status !== 'stopped' && this.session.status !== 'error') {
      throw new AppError('E_CONFLICT', '已有调试会话在运行，请先停止后再启动')
    }
    if (this.starting) throw new AppError('E_CONFLICT', '正在启动调试会话，请稍候')

    const file = await readLaunchConfigs(root)
    const config = file.configs.find((item) => item.id === input.configId)
    if (!config) throw new AppError('E_NOT_FOUND', '启动配置不存在，请刷新后重试')

    const context = {
      workspaceRoot: root,
      ...(input.activeFile ? { activeFile: resolve(root, input.activeFile) } : {})
    }
    const plan = buildLaunchPlan(config, context)

    // 审批必须在任何进程启动之前完成，且默认拒绝（未注入钩子时不允许启动）
    if (!this.options.authorize) {
      throw new AppError('E_FORBIDDEN', '调试启动缺少安全审批通道')
    }
    const allowed = await this.options.authorize(plan.commandLine)
    if (!allowed) {
      throw new AppError('E_FORBIDDEN', '用户拒绝了调试启动')
    }

    const session: DebugSession = {
      id: randomUUID(),
      configId: config.id,
      configName: config.name,
      status: 'starting',
      startedAt: Date.now(),
      commandLine: plan.commandLine,
      program: plan.program
    }
    this.session = session
    this.breakpoints = input.breakpoints.map((bp) => ({ ...bp }))
    this.lastStart = { ...input, breakpoints: this.breakpoints.map((bp) => ({ ...bp })) }
    this.pushSession()

    const sessionId = session.id
    const adapter = new NodeDebugAdapter({
      root,
      plan,
      stopOnEntry: config.stopOnEntry,
      ...(this.options.spawnImpl ? { spawnImpl: this.options.spawnImpl } : {}),
      ...(this.options.attachTimeoutMs ? { attachTimeoutMs: this.options.attachTimeoutMs } : {}),
      onOutput: (category, text) => {
        this.options.emit({ type: 'output', sessionId, category, text })
      },
      onPaused: (info) => {
        if (this.session) this.session.status = 'paused'
        this.pushSession()
        this.options.emit({ type: 'paused', sessionId, info })
      },
      onResumed: () => {
        if (this.session) this.session.status = 'running'
        this.pushSession()
        this.options.emit({ type: 'resumed', sessionId })
      },
      onExit: (code, message) => {
        if (this.session) {
          this.session.status = 'stopped'
          if (message) this.session.message = message
        }
        this.session = this.session ? { ...this.session } : null
        if (this.session) this.pushSession()
        this.adapter = null
        this.options.emit({
          type: 'exited',
          sessionId,
          code,
          ...(message ? { message } : {})
        })
      },
      onBreakpoints: (breakpoints) => {
        this.breakpoints = breakpoints
        this.options.emit({ type: 'breakpoints', breakpoints })
      }
    })

    this.adapter = adapter
    this.starting = true
    try {
      // 先把断点交给适配器，start() 里连接成功后统一 setBreakpointByUrl
      await adapter.setBreakpoints(this.breakpoints)
      await adapter.start()
      if (this.session && this.session.status === 'starting') {
        this.session.status = 'running'
        this.pushSession()
      }
      return this.session ?? session
    } catch (error) {
      const message = error instanceof Error ? error.message : '调试启动失败'
      await adapter.stop().catch(() => undefined)
      this.adapter = null
      if (this.session) {
        this.session.status = 'error'
        this.session.message = message
        this.pushSession()
      }
      throw new AppError('E_UNKNOWN', message)
    } finally {
      this.starting = false
    }
  }

  async stop(): Promise<boolean> {
    const adapter = this.adapter
    if (!adapter) return false
    this.adapter = null
    await adapter.stop().catch(() => undefined)
    const session = this.session
    if (session) {
      session.status = 'stopped'
      const sessionId = session.id
      this.pushSession()
      this.options.emit({ type: 'exited', sessionId, code: null, message: '已停止调试会话' })
    }
    return true
  }

  async setBreakpoints(breakpoints: DebugBreakpoint[]): Promise<DebugBreakpoint[]> {
    this.breakpoints = breakpoints.map((bp) => ({ ...bp }))
    if (this.lastStart) this.lastStart.breakpoints = this.breakpoints.map((bp) => ({ ...bp }))
    if (!this.adapter) return this.breakpoints
    return this.adapter.setBreakpoints(this.breakpoints)
  }

  async command(command: DebugCommand): Promise<void> {
    if (command === 'restart') {
      const last = this.lastStart
      if (!last) throw new AppError('E_NOT_FOUND', '还没有可重启的调试会话')
      await this.stop()
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 120))
      await this.start(last)
      return
    }
    const adapter = this.adapter
    if (!adapter) throw new AppError('E_NOT_FOUND', '当前没有调试会话')
    await adapter.command(command)
  }

  async scopes(frameId: string): Promise<DebugScope[]> {
    const adapter = this.adapter
    if (!adapter) throw new AppError('E_NOT_FOUND', '当前没有调试会话')
    return adapter.scopes(frameId)
  }

  async variables(variablesReference: string): Promise<DebugVariable[]> {
    const adapter = this.adapter
    if (!adapter) throw new AppError('E_NOT_FOUND', '当前没有调试会话')
    return adapter.variables(variablesReference)
  }

  async evaluate(expression: string, frameId?: string): Promise<DebugEvaluation> {
    const adapter = this.adapter
    if (!adapter) throw new AppError('E_NOT_FOUND', '当前没有调试会话')
    return adapter.evaluate({ expression, ...(frameId ? { frameId } : {}) })
  }

  async dispose(): Promise<void> {
    await this.adapter?.stop().catch(() => undefined)
    this.adapter = null
    this.session = null
  }

  private pushSession(): void {
    if (!this.session) return
    this.options.emit({ type: 'session', session: { ...this.session } })
  }
}
