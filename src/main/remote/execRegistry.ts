import { AppError } from '../../shared/errors'

/**
 * 当前活动远程工作区的执行上下文。
 *
 * 单窗口单工作区，因此用模块级注册表即可：Git / 搜索 / 任务服务在启动进程前
 * 询问一次「是否远程」，决定走本地 spawn 还是 `wsl.exe` / SSH。
 */

export interface RemoteExecOptions {
  /** 远端工作目录（Linux 绝对路径），默认用工作区根 */
  cwd?: string
  timeoutMs?: number
}

export interface RemoteRunResult {
  code: number | null
  stdout: string
  stderr: string
  spawnError?: string
  timedOut?: boolean
}

export interface RemoteStreamOptions extends RemoteExecOptions {
  onLine: (line: string) => void
  onStderr?: (chunk: string) => void
}

export interface RemoteStreamHandle {
  /** 终止远端命令 */
  cancel: () => void
  /** 命令结束（code 为退出码，失败时为 null） */
  done: Promise<{ code: number | null; stderr: string }>
}

export interface RemoteSpawnOptions {
  cwd?: string
  onStdout: (chunk: string) => void
  onStderr: (chunk: string) => void
  onExit: (code: number | null, message?: string) => void
}

export interface RemoteSpawnHandle {
  /** 结束远端命令（尽力而为：关闭本地进程/通道） */
  kill: () => void
}

export interface RemoteExec {
  kind: 'wsl' | 'ssh'
  /** 展示用标签，例如 `WSL · Ubuntu-22.04` */
  label: string
  /** 远端工作区根路径（Linux 绝对路径） */
  rootPath: string
  /**
   * 本地可访问的根路径：WSL 为 UNC 路径，SSH 为 null（文件必须走 SFTP）。
   * 用于把编辑器的本地绝对路径映射回远端路径。
   */
  localRoot: string | null
  run: (command: string, args: string[], options?: RemoteExecOptions) => Promise<RemoteRunResult>
  stream: (command: string, args: string[], options: RemoteStreamOptions) => RemoteStreamHandle
  /** 长任务（npm scripts / 自定义任务）：边跑边输出，可中断 */
  spawn: (command: string, args: string[], options: RemoteSpawnOptions) => RemoteSpawnHandle
  /** 本地绝对路径 → 远端路径；无法映射时返回 null */
  toRemotePath: (localPath: string | null | undefined) => string | null
}

let activeExec: RemoteExec | null = null

export function setRemoteExec(exec: RemoteExec | null): void {
  activeExec = exec
}

export function getRemoteExec(): RemoteExec | null {
  return activeExec
}

export function requireRemoteExec(): RemoteExec {
  if (!activeExec) {
    throw new AppError('E_UNSUPPORTED', '当前工作区不是远程工作区')
  }
  return activeExec
}

export function isRemoteWorkspace(): boolean {
  return activeExec !== null
}
