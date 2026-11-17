import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'
import { AppError } from '../../shared/errors'
import { TERMINAL_LIMITS } from '../../shared/ipcChannels'
import type { TerminalEvent, TerminalRunResult, TerminalState } from '../../shared/terminal'

function decoderLabelForCodePage(code: string): string {
  if (code === '65001') return 'utf-8'
  try {
    new TextDecoder(`windows-${code}`)
    return `windows-${code}`
  } catch {
    return 'gbk'
  }
}

export interface TerminalServiceOptions {
  /** 当前工作区根目录；切换工作区后可动态变化 */
  getRoot: () => string | null
  emit: (event: TerminalEvent) => void
  /** 便于单测注入进程启动逻辑 */
  spawnImpl?: typeof spawn
}

interface ActiveRun {
  runId: string
  child: ChildProcess
  bytes: number
  truncated: boolean
}

/**
 * 集成终端的主进程侧。
 *
 * 采用「一条命令一个子进程」的模型：不依赖原生 PTY，避免 electron-builder
 * 关闭 npmRebuild 时原生模块无法加载；子进程在当前工作区内以 shell 执行，
 * stdout/stderr 以事件流回推给 xterm 渲染。
 */
export class TerminalService {
  private readonly getRoot: () => string | null
  private readonly emit: (event: TerminalEvent) => void
  private readonly spawnImpl: typeof spawn
  private cwd: string | null = null
  private trackedRoot: string | null | undefined
  private active: ActiveRun | null = null
  private encoding: string | null = null
  private encodingPromise: Promise<string> | null = null

  constructor(options: TerminalServiceOptions) {
    this.getRoot = options.getRoot
    this.emit = options.emit
    this.spawnImpl = options.spawnImpl ?? spawn
  }

  state(): TerminalState {
    const root = this.getRoot()
    this.syncRoot(root)
    return { cwd: this.cwd ?? root ?? homedir(), root }
  }

  async run(command: string): Promise<TerminalRunResult> {
    const root = this.getRoot()
    this.syncRoot(root)
    if (this.active) {
      throw new AppError('E_CONFLICT', '命令正在运行，按 Ctrl+C 取消后再试')
    }

    const trimmed = command.trim()
    if (!trimmed) {
      throw new AppError('E_INVALID_INPUT', '命令不能为空')
    }

    const runId = randomUUID()
    const cd = /^cd(?:\s+(.*))?$/i.exec(trimmed)
    if (cd) {
      this.changeDirectory(cd[1]?.trim() ?? '')
      this.emit({ type: 'exit', runId, code: 0, state: this.state() })
      return { runId, ...this.state() }
    }

    const cwd = this.state().cwd
    const spec =
      process.platform === 'win32'
        ? {
            command: process.env['ComSpec'] ?? 'cmd.exe',
            args: ['/d', '/s', '/c', trimmed]
          }
        : {
            command: process.env['SHELL'] ?? '/bin/sh',
            args: ['-c', trimmed]
          }

    const encoding = await this.resolveEncoding()
    let child: ChildProcess
    try {
      child = this.spawnImpl(spec.command, spec.args, {
        cwd,
        windowsHide: true,
        env: { ...process.env, TERM: 'xterm-256color' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'message', runId, text: `无法启动终端：${message}\r\n` })
      this.emit({ type: 'exit', runId, code: 1, state: this.state() })
      throw new AppError('E_IO', `无法启动终端：${message}`)
    }

    const active: ActiveRun = { runId, child, bytes: 0, truncated: false }
    this.active = active
    const stdoutDecoder = new TextDecoder(encoding)
    const stderrDecoder = new TextDecoder(encoding)

    const forward = (chunk: Buffer, stream: 'stdout' | 'stderr', decoder: TextDecoder): void => {
      if (active.truncated) return
      active.bytes += chunk.byteLength
      if (active.bytes > TERMINAL_LIMITS.maxOutputBytes) {
        active.truncated = true
        this.emit({
          type: 'message',
          runId,
          text: `\r\n输出超过 ${Math.round(TERMINAL_LIMITS.maxOutputBytes / 1024)} KB，已停止。\r\n`
        })
        child.kill()
        return
      }
      this.emit({ type: 'output', runId, stream, text: decoder.decode(chunk, { stream: true }) })
    }

    child.stdout?.on('data', (chunk: Buffer) => forward(chunk, 'stdout', stdoutDecoder))
    child.stderr?.on('data', (chunk: Buffer) => forward(chunk, 'stderr', stderrDecoder))
    child.on('error', (error: Error) => {
      this.emit({ type: 'message', runId, text: `${error.message}\r\n` })
    })
    child.on('close', (code) => {
      if (this.active === active) this.active = null
      this.emit({ type: 'exit', runId, code, state: this.state() })
    })

    return { runId, ...this.state() }
  }

  cancel(): boolean {
    const active = this.active
    if (!active) return false
    active.child.kill()
    return true
  }

  dispose(): void {
    this.cancel()
  }

  private syncRoot(root: string | null): void {
    if (root !== this.trackedRoot) {
      this.trackedRoot = root
      this.cwd = null
      return
    }
    if (this.cwd && root && !this.isInside(this.cwd, root)) this.cwd = null
  }

  private isInside(candidate: string, root: string): boolean {
    const normalized = resolve(candidate)
    const base = resolve(root)
    return normalized === base || normalized.startsWith(base + sep)
  }

  private changeDirectory(argument: string): void {
    const state = this.state()
    const target =
      !argument || argument === '~'
        ? (state.root ?? homedir())
        : resolve(state.cwd, argument.replace(/^["']|["']$/g, ''))

    if (state.root && !this.isInside(target, state.root)) {
      this.emit({
        type: 'message',
        runId: 'cd',
        text: `终端限定在工作区内：${state.root}\r\n`
      })
      return
    }
    if (!existsSync(target)) {
      this.emit({ type: 'message', runId: 'cd', text: `目录不存在：${target}\r\n` })
      return
    }
    this.cwd = target
  }

  /**
   * cmd.exe 在管道模式下用系统代码页输出（简体中文 Windows 通常是 GBK），
   * 先查询一次 chcp 再选解码器，保证中文输出在 xterm 中不是乱码。
   */
  private async resolveEncoding(): Promise<string> {
    if (this.encoding) return this.encoding
    if (process.platform !== 'win32') {
      this.encoding = 'utf-8'
      return this.encoding
    }
    if (!this.encodingPromise) {
      this.encodingPromise = new Promise<string>((resolveEncoding) => {
        let output = ''
        const command = process.env['ComSpec'] ?? 'cmd.exe'
        const child = this.spawnImpl(command, ['/d', '/c', 'chcp'], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        })
        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8')
        })
        child.on('error', () => resolveEncoding('gbk'))
        child.on('close', () => {
          const code = /\b(\d{3,5})\b/.exec(output)?.[1] ?? '936'
          resolveEncoding(decoderLabelForCodePage(code))
        })
      }).then((label) => {
        this.encoding = label
        return label
      })
    }
    return this.encodingPromise
  }
}
