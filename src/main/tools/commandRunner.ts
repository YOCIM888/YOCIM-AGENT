import { spawn, type ChildProcess } from 'node:child_process'
import type { ToolExecutionOutcome } from '../../shared/agent'
import { AppError } from '../../shared/errors'

const COMMAND_OUTPUT_LIMIT = 64 * 1024

const SAFE_COMMANDS = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'tsc', 'vitest', 'git'])

const GIT_SAFE_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'branch',
  'rev-parse',
  'ls-files'
])

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-[a-z]*r[a-z]*f\b/i, reason: '递归强制删除' },
  { pattern: /\brm\s+-rf\b/i, reason: '递归强制删除' },
  {
    pattern: /\b(?:format|mkfs(?:\.\w+)?|diskpart|shutdown|reboot|halt)\b/i,
    reason: '系统级危险命令'
  },
  { pattern: /\breg\s+delete\b/i, reason: '删除注册表' },
  { pattern: /\bdel\s+\/f\s+\/s\b/i, reason: '递归强制删除' },
  { pattern: /\bremove-item\b[^\n]*-recurse/i, reason: '递归删除（PowerShell）' },
  { pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba|z|k)?sh\b/i, reason: '下载并执行远程脚本' },
  { pattern: /\b(?:iwr|invoke-webrequest)\b[^\n|]*\|\s*iex\b/i, reason: '下载并执行远程脚本' },
  { pattern: /\bgit\s+push\b/i, reason: '禁止自动推送远端' }
]

export function assertCommandAllowed(command: string): void {
  const trimmed = command.trim()
  if (!trimmed) {
    throw new AppError('E_TOOL_DENIED', '命令为空')
  }
  if (trimmed.length > 2000) {
    throw new AppError('E_TOOL_DENIED', '命令过长')
  }
  if (trimmed.includes('\0')) {
    throw new AppError('E_TOOL_DENIED', '命令包含非法字符')
  }

  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new AppError('E_TOOL_DENIED', `危险命令已拒绝：${reason}`)
    }
  }

  const tokens = trimmed.split(/\s+/)
  const executable = tokens[0].toLowerCase()
  if (!SAFE_COMMANDS.has(executable)) {
    throw new AppError('E_TOOL_DENIED', `命令不在白名单：${tokens[0]}`)
  }
  if (executable === 'git') {
    const subcommand = tokens[1]
    if (!subcommand || !GIT_SAFE_SUBCOMMANDS.has(subcommand)) {
      throw new AppError('E_TOOL_DENIED', `git 子命令不允许：${subcommand ?? '(空)'}`)
    }
  }
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

export interface RunCommandOptions {
  cwd: string
  timeoutMs: number
  signal: AbortSignal
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
      options.signal.removeEventListener('abort', onAbort)
    }

    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ ok: false, summary: '命令启动失败', content: error.message })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
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
