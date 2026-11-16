import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { AppError } from '../../shared/errors'
import type {
  GitBranches,
  GitCommitResult,
  GitDiffResult,
  GitLogEntry,
  GitOperationResult,
  GitStatus
} from '../../shared/git'
import { GIT_LIMITS } from '../../shared/ipcChannels'
import { normalizeWorkspaceRelativePath, type WorkspaceGuardLike } from '../workspace/pathGuard'
import {
  detectGit,
  gitFailureMessage,
  redactGitText,
  runGit,
  type GitAvailability,
  type GitRunResult
} from './gitRunner'
import { parseGitStatus } from './gitStatus'

export interface GitServiceDeps {
  getGuard: () => WorkspaceGuardLike
  /** 测试注入点：默认使用系统 git */
  runGit?: (args: string[], options: { cwd: string; timeoutMs: number }) => Promise<GitRunResult>
  detect?: () => Promise<GitAvailability>
}

const AVAILABILITY_TTL_MS = 30_000

type ChangeGroups = Pick<GitStatus, 'staged' | 'unstaged' | 'untracked' | 'conflicted'>

function emptyGroups(): ChangeGroups {
  return { staged: [], unstaged: [], untracked: [], conflicted: [] }
}

/** 只读命令不写入 Git 输出面板，避免状态刷新把日志刷满 */
const READ_ONLY_COMMANDS = new Set([
  'status',
  'diff',
  'show',
  'branch',
  'rev-parse',
  'remote',
  'for-each-ref',
  '--version'
])

function assertBranchName(input: string): string {
  const name = input.trim()
  if (!name) throw new AppError('E_INVALID_INPUT', '分支名不能为空')
  if (name.length > GIT_LIMITS.maxBranchLength) {
    throw new AppError('E_INVALID_INPUT', '分支名过长')
  }
  const hasControlCharacter = Array.from(name).some((character) => character.charCodeAt(0) < 32)
  if (
    name.startsWith('-') ||
    name.includes('..') ||
    name.includes('//') ||
    name.endsWith('/') ||
    name.endsWith('.lock') ||
    hasControlCharacter ||
    /[\s~^:?*[\\]/.test(name)
  ) {
    throw new AppError('E_INVALID_INPUT', '分支名包含非法字符')
  }
  if (!/^[\p{L}\p{N}._/-]+$/u.test(name)) {
    throw new AppError('E_INVALID_INPUT', '分支名包含非法字符')
  }
  return name
}

function assertRelativePath(input: string): string {
  const normalized = normalizeWorkspaceRelativePath(input)
  if (!normalized) throw new AppError('E_INVALID_INPUT', '路径不能为空')
  return normalized
}

function summarizeOutput(result: GitRunResult): string {
  const text = redactGitText(`${result.stdout}\n${result.stderr}`)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
  return text.slice(0, 2000)
}

export class GitService {
  private readonly commandLog: GitLogEntry[] = []
  private availability: GitAvailability | null = null
  private availabilityAt = 0
  private repoRootCache = new Map<string, string | null>()

  constructor(private readonly deps: GitServiceDeps) {}

  private get exec(): NonNullable<GitServiceDeps['runGit']> {
    return this.deps.runGit ?? runGit
  }

  private root(): string {
    return this.deps.getGuard().root
  }

  private async detectAvailability(force = false): Promise<GitAvailability> {
    const fresh = Date.now() - this.availabilityAt < AVAILABILITY_TTL_MS
    if (!force && this.availability && fresh) return this.availability
    const detect = this.deps.detect ?? detectGit
    this.availability = await detect()
    this.availabilityAt = Date.now()
    return this.availability
  }

  private async execGit(
    args: string[],
    options: { timeoutMs?: number; log?: boolean } = {}
  ): Promise<GitRunResult> {
    const startedAt = Date.now()
    const result = await this.exec(args, {
      cwd: this.root(),
      timeoutMs: options.timeoutMs ?? GIT_LIMITS.commandTimeoutMs
    })
    if (options.log !== false) this.logArgs(args, result, Date.now() - startedAt)
    return result
  }

  private logArgs(args: string[], result: GitRunResult, durationMs: number): void {
    const subcommand =
      args.find((arg) => !arg.startsWith('-') && !arg.includes('=')) ?? args[0] ?? ''
    if (READ_ONLY_COMMANDS.has(subcommand)) return
    const message = !result.spawnError && result.code === 0 ? '' : gitFailureMessage(result, '')
    this.commandLog.unshift({
      id: randomUUID(),
      ts: Date.now(),
      command: redactGitText(`git ${args.join(' ')}`),
      ok: !result.spawnError && result.code === 0,
      exitCode: result.code,
      durationMs,
      message: message || summarizeOutput(result).split('\n')[0] || ''
    })
    if (this.commandLog.length > GIT_LIMITS.maxLogEntries) {
      this.commandLog.length = GIT_LIMITS.maxLogEntries
    }
  }

  outputLog(): GitLogEntry[] {
    return [...this.commandLog]
  }

  private emptyStatus(message: string, available = true): GitStatus {
    return {
      available,
      isRepo: false,
      branch: '',
      detached: false,
      initial: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      ...emptyGroups(),
      message
    }
  }

  private async repoRoot(): Promise<string | null> {
    const root = this.root()
    if (this.repoRootCache.has(root)) return this.repoRootCache.get(root) ?? null
    const result = await this.exec(['rev-parse', '--show-toplevel'], {
      cwd: root,
      timeoutMs: GIT_LIMITS.commandTimeoutMs
    })
    const value = result.code === 0 ? result.stdout.trim() || null : null
    this.repoRootCache.set(root, value)
    return value
  }

  async status(): Promise<GitStatus> {
    const availability = await this.detectAvailability()
    if (!availability.available) {
      return { ...this.emptyStatus(availability.message ?? 'Git 不可用', false), available: false }
    }

    let guard: WorkspaceGuardLike
    try {
      guard = this.deps.getGuard()
    } catch {
      return this.emptyStatus('请先打开工作区')
    }

    const result = await this.exec(
      [
        '-c',
        'core.quotePath=false',
        'status',
        '--porcelain=v2',
        '--branch',
        '--untracked-files=all',
        '--',
        '.'
      ],
      { cwd: guard.root, timeoutMs: GIT_LIMITS.commandTimeoutMs }
    )
    if (result.spawnError) {
      return { ...this.emptyStatus('未检测到系统 Git，请安装 Git 后重试', false), available: false }
    }
    if (result.code !== 0) {
      return { ...this.emptyStatus(gitFailureMessage(result)), version: availability.version }
    }

    const parsed = parseGitStatus(result.stdout)
    const repoRoot = await this.repoRoot()
    return {
      available: true,
      ...(availability.version ? { version: availability.version } : {}),
      isRepo: true,
      ...(repoRoot ? { repoRoot } : {}),
      ...parsed
    }
  }

  async diff(input: { relativePath: string; staged: boolean }): Promise<GitDiffResult> {
    const guard = this.deps.getGuard()
    const relativePath = assertRelativePath(input.relativePath)
    const resolved = await guard.resolve(relativePath, { mustExist: false })
    const base: GitDiffResult = {
      relativePath,
      staged: input.staged,
      original: '',
      modified: '',
      binary: false
    }

    const spec = (revision: string): string =>
      revision ? `${revision}:./${relativePath}` : `:./${relativePath}`

    const original = await this.showFile(spec(input.staged ? 'HEAD' : ''))
    let modified = ''
    if (input.staged) {
      modified = await this.showFile(spec(''))
    } else {
      try {
        const info = await stat(resolved.absolutePath)
        if (info.isFile()) {
          if (info.size > GIT_LIMITS.maxDiffBytes) {
            return { ...base, message: '文件过大，无法显示 Diff' }
          }
          const raw = await readFile(resolved.absolutePath)
          if (raw.includes(0)) return { ...base, binary: true }
          modified = raw.toString('utf8')
        }
      } catch {
        // 文件已删除：modified 保持为空
      }
    }

    if (original.includes('\u0000') || modified.includes('\u0000')) {
      return { ...base, binary: true }
    }
    return { ...base, original, modified }
  }

  private async showFile(revisionPath: string): Promise<string> {
    const result = await this.exec(['-c', 'core.quotePath=false', 'show', revisionPath], {
      cwd: this.root(),
      timeoutMs: GIT_LIMITS.commandTimeoutMs
    })
    return result.code === 0 ? result.stdout : ''
  }

  async branches(): Promise<GitBranches> {
    const [local, remote, remotes, head] = await Promise.all([
      this.exec(['branch', '--format=%(refname:short)'], {
        cwd: this.root(),
        timeoutMs: GIT_LIMITS.commandTimeoutMs
      }),
      this.exec(['branch', '-r', '--format=%(refname:short)'], {
        cwd: this.root(),
        timeoutMs: GIT_LIMITS.commandTimeoutMs
      }),
      this.exec(['remote'], { cwd: this.root(), timeoutMs: GIT_LIMITS.commandTimeoutMs }),
      this.exec(['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: this.root(),
        timeoutMs: GIT_LIMITS.commandTimeoutMs
      })
    ])

    if (local.code !== 0) {
      return {
        current: '',
        detached: false,
        local: [],
        remote: [],
        hasRemote: false
      }
    }

    const toList = (text: string): string[] =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.endsWith('/HEAD'))

    const headName = head.code === 0 ? head.stdout.trim() : ''
    return {
      current: headName === 'HEAD' ? '' : headName,
      detached: headName === 'HEAD',
      local: toList(local.stdout),
      remote: toList(remote.stdout),
      hasRemote: toList(remotes.stdout).length > 0
    }
  }

  private async assertNoUntracked(paths: string[]): Promise<void> {
    const availability = await this.detectAvailability()
    if (!availability.available) {
      throw new AppError('E_UNSUPPORTED', availability.message ?? '未检测到系统 Git')
    }
    const status = await this.status()
    const untracked = new Set(status.untracked.map((change) => change.path))
    const blocked = paths.filter((path) => untracked.has(path))
    if (blocked.length) {
      throw new AppError(
        'E_INVALID_INPUT',
        `未跟踪文件不支持放弃更改，请从文件树删除：${blocked.slice(0, 3).join('、')}`
      )
    }
  }

  private validatePaths(paths: string[]): string[] {
    if (!paths.length) throw new AppError('E_INVALID_INPUT', '请选择文件')
    if (paths.length > GIT_LIMITS.maxPathsPerRequest) {
      throw new AppError('E_INVALID_INPUT', `单次最多操作 ${GIT_LIMITS.maxPathsPerRequest} 个文件`)
    }
    return [...new Set(paths.map((path) => assertRelativePath(path)))]
  }

  private async runOrThrow(
    args: string[],
    options: { timeoutMs?: number; fallback?: string } = {}
  ): Promise<GitRunResult> {
    const result = await this.execGit(args, options)
    if (result.spawnError || result.code !== 0) {
      throw new AppError('E_CONFLICT', gitFailureMessage(result, options.fallback))
    }
    return result
  }

  async stage(input: { paths: string[] }): Promise<GitStatus> {
    const paths = this.validatePaths(input.paths)
    await this.runOrThrow(['add', '--', ...paths], { fallback: '暂存失败' })
    return this.status()
  }

  async unstage(input: { paths: string[] }): Promise<GitStatus> {
    const paths = this.validatePaths(input.paths)
    let result = await this.execGit(['restore', '--staged', '--', ...paths])
    if (result.code !== 0) {
      const message = `${result.stderr}${result.stdout}`.toLowerCase()
      if (message.includes('unknown option') || message.includes('not a git command')) {
        result = await this.execGit(['reset', '-q', 'HEAD', '--', ...paths])
      }
      if (result.code !== 0 && (await this.isInitialCommit())) {
        // 首次提交前没有 HEAD，只能从索引移除
        result = await this.execGit(['rm', '--cached', '-r', '--quiet', '--', ...paths])
      }
    }
    if (result.spawnError || result.code !== 0) {
      throw new AppError('E_CONFLICT', gitFailureMessage(result, '取消暂存失败'))
    }
    return this.status()
  }

  private async isInitialCommit(): Promise<boolean> {
    const result = await this.exec(['rev-parse', '--verify', 'HEAD'], {
      cwd: this.root(),
      timeoutMs: GIT_LIMITS.commandTimeoutMs
    })
    return result.code !== 0
  }

  async discard(input: { paths: string[] }): Promise<GitStatus> {
    const paths = this.validatePaths(input.paths)
    await this.assertNoUntracked(paths)
    let result = await this.execGit(['restore', '--worktree', '--', ...paths])
    if (result.code !== 0) {
      const message = `${result.stderr}${result.stdout}`.toLowerCase()
      if (message.includes('unknown option') || message.includes('not a git command')) {
        result = await this.execGit(['checkout', '--', ...paths])
      }
    }
    if (result.spawnError || result.code !== 0) {
      throw new AppError('E_CONFLICT', gitFailureMessage(result, '放弃更改失败'))
    }
    return this.status()
  }

  async commit(input: { message: string; all: boolean }): Promise<GitCommitResult> {
    const message = input.message.trim()
    if (!message) throw new AppError('E_INVALID_INPUT', '提交信息不能为空')
    if (input.all) {
      await this.runOrThrow(['add', '-A'], { fallback: '暂存全部变更失败' })
    }
    const result = await this.runOrThrow(['commit', '-m', message], {
      fallback: '提交失败'
    })
    const head = await this.exec(['rev-parse', '--short', 'HEAD'], {
      cwd: this.root(),
      timeoutMs: GIT_LIMITS.commandTimeoutMs
    })
    return {
      status: await this.status(),
      commit: head.code === 0 ? head.stdout.trim() : '',
      summary: summarizeOutput(result).split('\n')[0] ?? ''
    }
  }

  private async network(args: string[], fallback: string): Promise<GitOperationResult> {
    const result = await this.execGit(args, { timeoutMs: GIT_LIMITS.networkTimeoutMs })
    if (result.spawnError || result.code !== 0) {
      throw new AppError('E_CONFLICT', gitFailureMessage(result, fallback))
    }
    return { status: await this.status(), output: summarizeOutput(result) }
  }

  pull(): Promise<GitOperationResult> {
    // 只做快进合并，避免自动产生合并提交
    return this.network(['pull', '--ff-only'], '拉取失败')
  }

  push(): Promise<GitOperationResult> {
    return this.network(['push'], '推送失败')
  }

  async publish(): Promise<GitOperationResult> {
    const status = await this.status()
    if (!status.isRepo) throw new AppError('E_UNSUPPORTED', status.message ?? '不是 Git 仓库')
    if (status.detached || !status.branch) {
      throw new AppError('E_INVALID_INPUT', '分离头指针状态无法发布分支，请先切换到分支')
    }
    const branches = await this.branches()
    if (!branches.hasRemote) {
      throw new AppError('E_NOT_FOUND', '未配置远程仓库，请先添加远程 origin')
    }
    return this.network(['push', '-u', 'origin', status.branch], '发布分支失败')
  }

  async checkout(input: { branch: string; create: boolean }): Promise<GitStatus> {
    const name = assertBranchName(input.branch)
    const args = input.create ? ['checkout', '-b', name] : ['checkout', name]
    await this.runOrThrow(args, { fallback: input.create ? '新建分支失败' : '切换分支失败' })
    this.repoRootCache.clear()
    return this.status()
  }

  async init(): Promise<GitStatus> {
    const availability = await this.detectAvailability(true)
    if (!availability.available) {
      throw new AppError('E_UNSUPPORTED', availability.message ?? '未检测到系统 Git')
    }
    await this.runOrThrow(['init'], { fallback: '初始化仓库失败' })
    this.repoRootCache.clear()
    return this.status()
  }
}
