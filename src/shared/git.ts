/** Git 视图使用的共享类型（主进程与 renderer 共用） */

/** 变更在索引区（staged）或工作区（unstaged）的状态字符，`.` 表示无变化 */
export interface GitFileChange {
  /** 工作区相对路径（正斜杠），与文件树、编辑器一致 */
  path: string
  /** 重命名 / 复制前的原路径 */
  originalPath?: string
  /** 索引区状态字符，例如 M / A / D / R */
  indexStatus: string
  /** 工作区状态字符 */
  worktreeStatus: string
  /** 是否为未合并（冲突）条目 */
  conflict?: boolean
}

export interface GitStatus {
  /** 系统是否有可用的 git 可执行文件 */
  available: boolean
  /** 是否检测到本地 Git 版本 */
  version?: string
  /** 当前工作区是否为 Git 仓库 */
  isRepo: boolean
  /** 仓库根目录（可能是工作区的上级目录） */
  repoRoot?: string
  branch: string
  /** 分离头指针状态 */
  detached: boolean
  /** 尚无任何提交 */
  initial: boolean
  upstream: string | null
  ahead: number
  behind: number
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: GitFileChange[]
  conflicted: GitFileChange[]
  /** 不可用 / 非仓库 / 命令失败时的可读提示 */
  message?: string
}

export interface GitDiffResult {
  relativePath: string
  staged: boolean
  /** 对比左侧（HEAD 或索引区版本） */
  original: string
  /** 对比右侧（索引区或工作区版本） */
  modified: string
  /** 二进制或超限文件只返回提示，不返回内容 */
  binary: boolean
  message?: string
}

export interface GitBranches {
  current: string
  detached: boolean
  local: string[]
  remote: string[]
  /** 是否配置了远程仓库 */
  hasRemote: boolean
}

export interface GitCommitResult {
  status: GitStatus
  commit: string
  summary: string
}

export interface GitOperationResult {
  status: GitStatus
  /** 命令输出摘要（已脱敏） */
  output: string
}

/** Git 输出面板条目：最近执行的命令与结果 */
export interface GitLogEntry {
  id: string
  ts: number
  /** 已脱敏的命令行 */
  command: string
  ok: boolean
  exitCode: number | null
  durationMs: number
  /** 失败原因或输出首行 */
  message: string
}

/** 去重后的变更文件数（活动栏 badge 使用） */
export function countGitChanges(status: GitStatus): number {
  const paths = new Set<string>()
  for (const group of [status.staged, status.unstaged, status.untracked, status.conflicted]) {
    for (const change of group) paths.add(change.path)
  }
  return paths.size
}
