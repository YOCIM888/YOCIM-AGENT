import { spawn, type ChildProcess } from 'node:child_process'
import type { ToolExecutionOutcome } from '../../shared/agent'

const COMMAND_OUTPUT_LIMIT = 64 * 1024

/** 输出事件的节流间隔：合并碎片，避免渲染层被高频小 chunk 打爆 */
export const COMMAND_OUTPUT_FLUSH_MS = 300

export interface RunCommandOptions {
  cwd: string
  timeoutMs: number
  signal: AbortSignal
  /** 增量输出回调（节流合并）；仅 stdout/stderr 合并后的新文本 */
  onOutput?: (text: string) => void
  /** 节流间隔，测试时可调小 */
  flushIntervalMs?: number
  /** 追加到安全基础环境变量上的覆盖项（如 ELECTRON_RUN_AS_NODE） */
  env?: Record<string, string>
}

function buildSafeEnv(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const keys = [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'windir',
    'ComSpec',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'HOME',
    'SHELL'
  ]
  for (const key of keys) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  if (overrides) Object.assign(env, overrides)
  return env
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  }
  child.kill()
}

/**
 * 共享的命令执行主体：接受一个 child 工厂，统一处理超时、abort、输出节流与截断。
 * spawn 的细节（shell 字符串 vs argv 数组）由各入口自己决定。
 */
function runChild(startChild: (env: NodeJS.ProcessEnv) => ChildProcess, options: RunCommandOptions): Promise<ToolExecutionOutcome> {
  return new Promise((resolve) => {
    let output = ''
    let truncated = false
    let timedOut = false

    const appendOutput = (chunk: Buffer): void => {
      if (output.length >= COMMAND_OUTPUT_LIMIT) {
        truncated = true
        return
      }
      const remaining = COMMAND_OUTPUT_LIMIT - output.length
      const text = chunk.toString('utf8')
      output += text.slice(0, remaining)
      if (text.length > remaining) truncated = true
      pendingStream += text
    }

    /** 节流：新输出先进 pendingStream，定时统一推送 */
    let pendingStream = ''
    let pendingSince: number | null = null
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const flushInterval = options.flushIntervalMs ?? COMMAND_OUTPUT_FLUSH_MS

    const flushPending = (): void => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (pendingStream && options.onOutput) {
        const text = pendingStream
        pendingStream = ''
        pendingSince = null
        try {
          options.onOutput(text)
        } catch {
          // 输出回调失败不影响命令执行
        }
      } else {
        pendingStream = ''
        pendingSince = null
      }
    }

    const scheduleFlush = (): void => {
      if (!options.onOutput) return
      if (pendingSince === null) pendingSince = Date.now()
      if (flushTimer) return
      const elapsed = Date.now() - pendingSince
      const delay = Math.max(0, flushInterval - elapsed)
      flushTimer = setTimeout(() => {
        flushTimer = null
        flushPending()
      }, delay)
    }

    let child: ChildProcess
    try {
      child = startChild(buildSafeEnv(options.env))
    } catch (error) {
      resolve({
        ok: false,
        summary: '命令启动失败',
        content: error instanceof Error ? error.message : '命令启动失败'
      })
      return
    }

    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child)
    }, options.timeoutMs)

    const onAbort = (): void => {
      killProcessTree(child)
    }
    options.signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = (): void => {
      clearTimeout(timer)
      if (flushTimer) clearTimeout(flushTimer)
      options.signal.removeEventListener('abort', onAbort)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      appendOutput(chunk)
      scheduleFlush()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      appendOutput(chunk)
      scheduleFlush()
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ ok: false, summary: '命令启动失败', content: error.message })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      flushPending()
      cleanup()
      const aborted = options.signal.aborted
      const ok = code === 0 && !timedOut && !aborted
      const suffix = truncated ? '\n[输出已截断]' : ''
      const summary = aborted
        ? '命令已取消'
        : timedOut
          ? `命令超时（${options.timeoutMs}ms）`
          : `退出码 ${code ?? 'unknown'}`
      resolve({
        ok,
        summary,
        content: `${output || '（无输出）'}${suffix}`
      })
    })
  })
}

/**
 * 执行一条 shell 命令字符串（run_command 工具专用）。
 * 注意：这里刻意启用 shell 以支持管道/重定向等语法；所有模型可控输入必须先在
 * commandPolicy / toolService 层通过白名单与危险正则校验后才会走到这里。
 */
export function runWorkspaceCommand(
  command: string,
  options: RunCommandOptions
): Promise<ToolExecutionOutcome> {
  return runChild(
    (env) =>
      spawn(command, {
        cwd: options.cwd,
        shell: true,
        windowsHide: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      }),
    options
  )
}

/**
 * 以 argv 数组执行命令（验证类工具专用）：spawn(argv[0], argv.slice(1), shell:false)。
 * 不使用 shell，参数里的 ; | & $ ` 等都是普通字符，从执行层面根除命令注入。
 */
export function runWorkspaceCommandArgv(
  argv: string[],
  options: RunCommandOptions
): Promise<ToolExecutionOutcome> {
  if (argv.length === 0) {
    return Promise.resolve({ ok: false, summary: '命令为空', content: '命令参数为空' })
  }
  return runChild(
    (env) =>
      spawn(argv[0], argv.slice(1), {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      }),
    options
  )
}
