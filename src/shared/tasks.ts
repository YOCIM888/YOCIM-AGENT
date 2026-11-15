/**
 * 运行与任务（§3.7 第一阶段运行部分）。
 * 任务来源：package.json scripts 与工作区 `.yocim/tasks.json` 自定义任务。
 */

export type TaskSource = 'npm' | 'custom'

export type PackageManager = 'npm' | 'pnpm' | 'yarn'

export interface TaskDefinition {
  /** 稳定标识：`npm:<script>` / `custom:<label>` */
  id: string
  label: string
  source: TaskSource
  /** 展示用的命令行（不含实际 shell 转义） */
  commandLine: string
  /** 实际可执行文件（Windows 为 .cmd） */
  command: string
  args: string[]
  /** 相对工作区根的目录；空表示工作区根 */
  cwd?: string
  /** 来源说明，例如「package.json scripts」或「.yocim/tasks.json」 */
  detail?: string
}

export interface TaskDiscovery {
  /** 未找到 package.json 或读取失败时的可读提示 */
  error?: string
  packageManager: PackageManager | null
  scriptsFile: string | null
  tasksFile: string | null
  tasks: TaskDefinition[]
}

export type TaskRunStatus = 'running' | 'exited' | 'failed' | 'stopped'

export interface TaskRun {
  runId: string
  taskId: string
  label: string
  commandLine: string
  status: TaskRunStatus
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  /** 启动失败、被截断等提示 */
  message?: string
  truncated?: boolean
}

export type TaskEvent =
  | { type: 'started'; run: TaskRun }
  | { type: 'output'; runId: string; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'exited'; run: TaskRun }

export function isTerminalTaskStatus(status: TaskRunStatus): boolean {
  return status !== 'running'
}
