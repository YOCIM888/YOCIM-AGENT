import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { AppError } from '../../shared/errors'
import { TASK_LIMITS } from '../../shared/ipcChannels'
import type {
  PackageManager,
  TaskDefinition,
  TaskDiscovery,
  TaskEvent,
  TaskRun
} from '../../shared/tasks'
import { createAnsiStripper } from '../util/ansi'
import { redactSecrets } from '../util/redact'

interface CustomTaskFileEntry {
  label?: unknown
  command?: unknown
  args?: unknown
  cwd?: unknown
  detail?: unknown
}

interface RunningTask {
  run: TaskRun
  child: ChildProcess
  bytes: number
  truncated: boolean
  timer?: NodeJS.Timeout
}

export interface TaskServiceOptions {
  getRoot: () => string | null
  emit: (event: TaskEvent) => void
  /** 便于测试注入进程启动逻辑 */
  spawnImpl?: typeof spawn
}

const NPM_SCRIPTS_DETAIL = 'package.json scripts'
const CUSTOM_TASKS_FILE = '.yocim/tasks.json'

function isWindows(): boolean {
  return process.platform === 'win32'
}

/** Windows 下 npm/pnpm/yarn 都是 .cmd，Node 20+ 不允许直接 spawn .cmd（EINVAL） */
function executableFor(command: string): string {
  if (!isWindows()) return command
  return /\.(cmd|bat)$/i.test(command) ? command : `${command}.cmd`
}

function quoteArg(arg: string): string {
  if (!arg) return '""'
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

function quoteCmdArg(arg: string): string {
  if (!arg) return '""'
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

/**
 * Windows 上 .cmd/.bat 必须经 cmd.exe 执行。
 * 命令与脚本名都来自校验过的清单（npm scripts 名限定 `[A-Za-z0-9:_.-]`），
 * 自定义任务则要求用户确认完整命令，因此这里的 cmd 包裹不引入任意注入面。
 */
export function buildSpawnSpec(
  command: string,
  args: string[]
): { command: string; args: string[]; viaCmd: boolean } {
  if (!isWindows() || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args, viaCmd: false }
  }
  const comspec = process.env['ComSpec'] ?? 'cmd.exe'
  const line = [command, ...args].map(quoteCmdArg).join(' ')
  return { command: comspec, args: ['/d', '/s', '/c', line], viaCmd: true }
}

export function describeCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteArg).join(' ')
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** 依次探测 pnpm / yarn 锁文件，都没有则用 npm */
export async function detectPackageManager(root: string): Promise<PackageManager> {
  if ((await readTextIfExists(join(root, 'pnpm-lock.yaml'))) !== null) return 'pnpm'
  if ((await readTextIfExists(join(root, 'yarn.lock'))) !== null) return 'yarn'
  return 'npm'
}

interface PackageJsonShape {
  scripts?: Record<string, unknown>
  main?: unknown
}

async function readPackageJson(root: string): Promise<PackageJsonShape | null> {
  const text = await readTextIfExists(join(root, 'package.json'))
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as PackageJsonShape
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function isSafeScriptName(name: string): boolean {
  // npm script 名只允许字母数字与 : - _ . ；同时避免 shell 元字符
  return /^[A-Za-z0-9:_.-]{1,200}$/.test(name)
}

function normalizeCustomTasks(raw: unknown, root: string): TaskDefinition[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as { tasks?: unknown }).tasks
  if (!Array.isArray(list)) return []

  const tasks: TaskDefinition[] = []
  const seen = new Set<string>()
  for (const entry of list.slice(0, 100) as CustomTaskFileEntry[]) {
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    const command = typeof entry.command === 'string' ? entry.command.trim() : ''
    if (!label || !command) continue
    if (label.length > TASK_LIMITS.maxTaskLabelLength) continue
    if (command.length > TASK_LIMITS.maxCommandLength) continue
    // 自定义任务不经过 shell，命令里出现 shell 元字符直接拒绝，避免误以为能串联
    if (/[\n\r]/.test(command)) continue
    const args = Array.isArray(entry.args)
      ? entry.args
          .slice(0, TASK_LIMITS.maxTaskArgs)
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.slice(0, TASK_LIMITS.maxArgLength))
      : []
    let cwd: string | undefined
    if (typeof entry.cwd === 'string' && entry.cwd.trim()) {
      const resolved = resolve(root, entry.cwd.trim())
      if (resolved !== root && !resolved.startsWith(root + sep)) continue
      cwd = resolved
        .slice(root.length)
        .replace(/^[\\/]+/, '')
        .split(sep)
        .join('/')
    }
    let id = `custom:${label}`
    let suffix = 2
    while (seen.has(id)) id = `custom:${label}#${suffix++}`
    seen.add(id)
    tasks.push({
      id,
      label,
      source: 'custom',
      command,
      args,
      commandLine: describeCommand(command, args),
      ...(cwd && cwd !== '' ? { cwd } : {}),
      detail: typeof entry.detail === 'string' ? entry.detail.slice(0, 200) : CUSTOM_TASKS_FILE
    })
  }
  return tasks
}

export class TaskService {
  private readonly options: TaskServiceOptions
  private readonly spawnImpl: typeof spawn
  private readonly running = new Map<string, RunningTask>()
  private readonly history: TaskRun[] = []

  constructor(options: TaskServiceOptions) {
    this.options = options
    this.spawnImpl = options.spawnImpl ?? spawn
  }

  async list(): Promise<TaskDiscovery> {
    const root = this.options.getRoot()
    if (!root) {
      return {
        error: '未打开工作区，无法发现任务',
        packageManager: null,
        scriptsFile: null,
        tasksFile: null,
        tasks: []
      }
    }

    const packageJson = await readPackageJson(root)
    const packageManager = await detectPackageManager(root)
    const tasks: TaskDefinition[] = []

    if (packageJson?.scripts && typeof packageJson.scripts === 'object') {
      const executable = executableFor(packageManager)
      for (const name of Object.keys(packageJson.scripts).sort((a, b) => a.localeCompare(b))) {
        if (!isSafeScriptName(name)) continue
        tasks.push({
          id: `npm:${name}`,
          label: name,
          source: 'npm',
          command: executable,
          args: ['run', name],
          commandLine: describeCommand(packageManager, ['run', name]),
          detail: NPM_SCRIPTS_DETAIL
        })
      }
    }

    const customText = await readTextIfExists(join(root, CUSTOM_TASKS_FILE))
    let tasksFile: string | null = null
    let error: string | undefined
    if (customText !== null) {
      tasksFile = CUSTOM_TASKS_FILE
      try {
        tasks.push(...normalizeCustomTasks(JSON.parse(customText), root))
      } catch {
        error = `${CUSTOM_TASKS_FILE} 不是合法 JSON，已忽略自定义任务`
      }
    }

    if (!packageJson && customText === null) {
      error = '未找到 package.json 或 .yocim/tasks.json，暂无可运行的任务'
    }

    return {
      ...(error ? { error } : {}),
      packageManager: packageJson ? packageManager : null,
      scriptsFile: packageJson ? 'package.json' : null,
      tasksFile,
      tasks
    }
  }

  async start(input: { taskId: string }): Promise<TaskRun> {
    const root = this.options.getRoot()
    if (!root) throw new AppError('E_NO_WORKSPACE', '未打开工作区，无法运行任务')

    if (this.countRunning() >= TASK_LIMITS.maxConcurrentRuns) {
      throw new AppError(
        'E_CONFLICT',
        `最多同时运行 ${TASK_LIMITS.maxConcurrentRuns} 个任务，请先停止其他任务`
      )
    }

    const discovery = await this.list()
    const task = discovery.tasks.find((item) => item.id === input.taskId)
    if (!task) throw new AppError('E_NOT_FOUND', '任务已不存在，请刷新任务列表')

    const cwd = task.cwd ? join(root, task.cwd) : root
    const runId = randomUUID()
    const run: TaskRun = {
      runId,
      taskId: task.id,
      label: task.label,
      commandLine: task.commandLine,
      status: 'running',
      startedAt: Date.now()
    }

    let child: ChildProcess
    try {
      const spec = buildSpawnSpec(task.command, task.args)
      child = this.spawnImpl(spec.command, spec.args, {
        cwd,
        windowsHide: true,
        env: { ...process.env, YOCIM_TASK: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '任务启动失败'
      const failed: TaskRun = { ...run, status: 'failed', message, endedAt: Date.now() }
      this.remember(failed)
      this.options.emit({ type: 'started', run: failed })
      return failed
    }

    const entry: RunningTask = { run, child, bytes: 0, truncated: false }
    const stripStdout = createAnsiStripper()
    const stripStderr = createAnsiStripper()
    this.running.set(runId, entry)
    this.options.emit({ type: 'started', run })

    const append = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (entry.bytes >= TASK_LIMITS.maxOutputBytes) {
        if (!entry.truncated) {
          entry.truncated = true
          run.truncated = true
          this.options.emit({
            type: 'output',
            runId,
            stream: 'stderr',
            text: `\n[输出超过 ${Math.round(TASK_LIMITS.maxOutputBytes / 1024)} KB，已停止追加]\n`
          })
        }
        return
      }
      const raw = chunk.toString('utf8')
      const text = stream === 'stdout' ? stripStdout(raw) : stripStderr(raw)
      const remaining = TASK_LIMITS.maxOutputBytes - entry.bytes
      const slice = text.length > remaining ? text.slice(0, remaining) : text
      entry.bytes += slice.length
      if (slice) {
        this.options.emit({ type: 'output', runId, stream, text: redactSecrets(slice) })
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk))

    child.on('error', (error) => {
      if (entry.timer) clearTimeout(entry.timer)
      this.finish(runId, 'failed', null, error.message)
    })

    child.on('close', (code) => {
      if (entry.timer) clearTimeout(entry.timer)
      const stopped = run.status === 'stopped'
      this.finish(runId, stopped ? 'stopped' : code === 0 ? 'exited' : 'failed', code)
    })

    return run
  }

  async stop(runId: string): Promise<boolean> {
    const entry = this.running.get(runId)
    if (!entry) return false
    entry.run.status = 'stopped'
    this.killTree(entry.child)
    entry.timer = setTimeout(() => {
      if (this.running.has(runId)) this.finish(runId, 'stopped', null, '进程未在超时内退出')
    }, TASK_LIMITS.stopTimeoutMs)
    return true
  }

  listRuns(): TaskRun[] {
    return [...this.running.values()].map((item) => item.run).concat(this.history)
  }

  dispose(): void {
    for (const entry of this.running.values()) {
      if (entry.timer) clearTimeout(entry.timer)
      this.killTree(entry.child)
    }
    this.running.clear()
  }

  private countRunning(): number {
    return this.running.size
  }

  private remember(run: TaskRun): void {
    this.history.unshift(run)
    if (this.history.length > TASK_LIMITS.maxRuns) this.history.length = TASK_LIMITS.maxRuns
  }

  private finish(
    runId: string,
    status: TaskRun['status'],
    code: number | null,
    message?: string
  ): void {
    const entry = this.running.get(runId)
    if (!entry) return
    this.running.delete(runId)
    const run: TaskRun = {
      ...entry.run,
      status,
      exitCode: code,
      endedAt: Date.now(),
      ...(entry.truncated ? { truncated: true } : {}),
      ...(message ? { message } : {})
    }
    entry.run = run
    this.remember(run)
    this.options.emit({ type: 'exited', run })
  }

  private killTree(child: ChildProcess): void {
    if (child.exitCode !== null || child.killed) return
    const pid = child.pid
    if (isWindows() && pid) {
      // 参数数组调用 taskkill，不经过 shell；/T 一并结束 npm 派生的子进程
      try {
        this.spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
        return
      } catch {
        // 退回 child.kill
      }
    }
    child.kill()
  }
}
