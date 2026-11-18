import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
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
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    // 非 Win 下 spawn(shell:true) 的 pid 是 shell， Kill shell 会留下真实命令。
    // 子进程以 detached 启动成为进程组组长，负 pid 一次性杀掉整组。
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      // 进程组可能已退出
    }
  }
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill()
    } catch {
      // 已退出
    }
  }
}

/**
 * 共享的命令执行主体：接受一个 child 工厂，统一处理超时、abort、输出节流与截断。
 * spawn 的细节（shell 字符串 vs argv 数组）由各入口自己决定。
 */
function runChild(
  startChild: (env: NodeJS.ProcessEnv) => ChildProcess,
  options: RunCommandOptions
): Promise<ToolExecutionOutcome> {
  return new Promise((resolve) => {
    let output = ''
    let truncated = false
    let timedOut = false
    let settled = false
    let exitCode: number | null = null
    // 管道按字节分块，中文 UTF-8 的多字节序列常被切在两块之间；
    // StringDecoder 会暂存半截序列，下次 write 时补齐，避免产出 U+FFFD。
    const decoder = new StringDecoder('utf8')

    const appendOutput = (text: string): void => {
      if (!text) return
      if (output.length >= COMMAND_OUTPUT_LIMIT) {
        truncated = true
        return
      }
      const remaining = COMMAND_OUTPUT_LIMIT - output.length
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

    let timer: ReturnType<typeof setTimeout> | null = null

    function cleanup(): void {
      if (timer) clearTimeout(timer)
      if (flushTimer) clearTimeout(flushTimer)
      options.signal.removeEventListener('abort', onAbort)
    }

    /** 统一收尾：超时/abort 也走这里，避免把 resolve 绑在可能迟迟不来的 close 上 */
    function settle(override?: { ok: boolean; summary: string }): void {
      if (settled) return
      settled = true
      // 冲刷 decoder 里残留的半截字节序列（正常结束时为空）
      const tail = decoder.end()
      if (tail) appendOutput(tail)
      flushPending()
      cleanup()
      const aborted = options.signal.aborted
      const ok = override?.ok ?? (exitCode === 0 && !timedOut && !aborted)
      const summary =
        override?.summary ??
        (aborted
          ? '命令已取消'
          : timedOut
            ? `命令超时（${options.timeoutMs}ms）`
            : `退出码 ${exitCode ?? 'unknown'}`)
      const suffix = truncated ? '\n[输出已截断]' : ''
      resolve({ ok, summary, content: `${output || '（无输出）'}${suffix}` })
    }

    function onAbort(): void {
      if (settled) return
      killProcessTree(child)
      settle()
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      appendOutput(decoder.write(chunk))
      scheduleFlush()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return
      appendOutput(decoder.write(chunk))
      scheduleFlush()
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ ok: false, summary: '命令启动失败', content: error.message })
    })

    child.on('close', (code) => {
      exitCode = code
      settle()
    })

    timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      killProcessTree(child)
      // 孤儿进程可能继承管道写端，close 要等它退出；这里主动结束，不等 close。
      settle()
    }, options.timeoutMs)

    options.signal.addEventListener('abort', onAbort, { once: true })
    if (options.signal.aborted) onAbort()
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
        // 非 Win 下让 shell 成为进程组组长，超时/取消时连同真实命令一起杀掉。
        detached: process.platform !== 'win32',
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
        detached: process.platform !== 'win32',
        windowsHide: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      }),
    options
  )
}
