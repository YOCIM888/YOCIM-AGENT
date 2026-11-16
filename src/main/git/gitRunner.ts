import { spawn } from 'node:child_process'
import { redactSecrets } from '../util/redact'
import { getRemoteExec, type RemoteExec } from '../remote/execRegistry'

export interface GitRunOptions {
  cwd: string
  timeoutMs: number
}

export interface GitRunResult {
  code: number | null
  stdout: string
  stderr: string
  /** 进程无法启动（通常是系统未安装 git） */
  spawnError?: string
  timedOut?: boolean
  /** 输出超过上限被截断 */
  truncated?: boolean
}

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

/** 脱敏：远端 URL 里的凭据、命令行中的 token / password 参数 */
export const redactGitText = redactSecrets

function firstMeaningfulLine(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  return line ? redactGitText(line).slice(0, 300) : ''
}

/**
 * 以参数数组调用系统 git，不经过 shell。
 * 只允许 GitService 内部调用，避免任意命令注入。
 */
export function runGit(args: string[], options: GitRunOptions): Promise<GitRunResult> {
  const remote = getRemoteExec()
  if (remote) return runGitRemote(remote, args, options)
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false
    let timedOut = false

    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      if (target === 'stdout') {
        if (stdout.length >= MAX_OUTPUT_BYTES) {
          truncated = true
          return
        }
        const remaining = MAX_OUTPUT_BYTES - stdout.length
        stdout += text.slice(0, remaining)
        if (text.length > remaining) truncated = true
      } else {
        stderr = `${stderr}${text}`.slice(-8000)
      }
    }

    let child
    try {
      child = spawn('git', args, {
        cwd: options.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        spawnError: error instanceof Error ? error.message : 'git 启动失败'
      })
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk))

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr, spawnError: error.message })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code,
        stdout,
        stderr,
        ...(timedOut ? { timedOut: true } : {}),
        ...(truncated ? { truncated: true } : {})
      })
    })
  })
}

/** 远程工作区：Git 跑在 WSL/远端主机上，路径用远端绝对路径 */
async function runGitRemote(
  remote: RemoteExec,
  args: string[],
  options: GitRunOptions
): Promise<GitRunResult> {
  const cwd = remote.toRemotePath(options.cwd) ?? remote.rootPath
  try {
    const result = await remote.run('git', args, { cwd, timeoutMs: options.timeoutMs })
    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.spawnError ? { spawnError: result.spawnError } : {}),
      ...(result.timedOut ? { timedOut: true } : {})
    }
  } catch (error) {
    return {
      code: null,
      stdout: '',
      stderr: '',
      spawnError: error instanceof Error ? error.message : '远端 Git 启动失败'
    }
  }
}

export interface GitAvailability {
  available: boolean
  version?: string
  message?: string
}

/** `git --version` 探测；结果由 GitService 缓存 */
export async function detectGit(): Promise<GitAvailability> {
  const result = await runGit(['--version'], {
    cwd: process.cwd(),
    timeoutMs: 10_000
  })
  if (result.spawnError || result.code !== 0) {
    return {
      available: false,
      message: '未检测到系统 Git，请安装 Git 后重启应用（https://git-scm.com/downloads）'
    }
  }
  const match = /git version (\S+)/i.exec(result.stdout)
  return { available: true, version: match?.[1] ?? 'unknown' }
}

/** 把 git 的 stderr 映射成可读提示，避免直接把命令输出抛给用户 */
export function gitFailureMessage(result: GitRunResult, fallback = 'Git 命令执行失败'): string {
  if (result.spawnError) return '未检测到系统 Git，请安装 Git 后重启应用'
  if (result.timedOut) return 'Git 命令超时，请检查网络或仓库状态后重试'
  const raw = redactGitText(result.stderr || result.stdout).trim()
  const lower = raw.toLowerCase()
  if (!lower) return fallback
  if (lower.includes('not a git repository')) return '当前工作区不是 Git 仓库，请先初始化仓库'
  if (lower.includes('no upstream') || lower.includes('has no upstream branch')) {
    return '当前分支没有远程跟踪分支，请先发布分支'
  }
  if (
    lower.includes('authentication failed') ||
    lower.includes('could not read username') ||
    lower.includes('could not read password') ||
    lower.includes('permission denied (publickey)')
  ) {
    return 'Git 凭据认证失败，请在系统凭据管理器中配置后重试'
  }
  if (
    lower.includes('conflict') ||
    lower.includes('automatic merge failed') ||
    lower.includes('fix conflicts')
  ) {
    return '存在冲突，请先解决冲突并暂存后再操作'
  }
  if (
    lower.includes('your local changes') ||
    lower.includes('would be overwritten') ||
    lower.includes('please commit your changes or stash')
  ) {
    return '本地修改会被覆盖，请先暂存或放弃更改'
  }
  if (lower.includes('nothing to commit') || lower.includes('no changes added to commit')) {
    return '没有可提交的变更'
  }
  if (
    lower.includes('please tell me who you are') ||
    lower.includes('unable to auto-detect email')
  ) {
    return 'Git 未配置用户信息，请先设置 user.name 与 user.email'
  }
  if (lower.includes('not fully merged')) return '分支尚未合并，已阻止删除'
  if (lower.includes('detected dubious ownership')) {
    return 'Git 检测到仓库所有权异常，请将工作区加入 safe.directory'
  }
  return firstMeaningfulLine(raw) || fallback
}
