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
}

function buildSafeEnv(): NodeJS.ProcessEnv {
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
  return env
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  }
  child.kill()
}

export function runWorkspaceCommand(
  command: string,
  options: RunCommandOptions
): Promise<ToolExecutionOutcome> {
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
      child = spawn(command, {
        cwd: options.cwd,
        shell: true,
        windowsHide: true,
        env: buildSafeEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      })
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
