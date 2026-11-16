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

/* -------------------------------------------------------------------------- */
/* 提交图（Git Graph）                                                          */
/* -------------------------------------------------------------------------- */

/** 提交图上的一个节点 */
export interface GitCommitNode {
  /** 完整 sha */
  sha: string
  /** 短 sha */
  shortSha: string
  /** 父提交 sha 列表；长度 > 1 表示合并提交 */
  parents: string[]
  /** 作者名 */
  author: string
  /** 作者邮箱 */
  authorEmail: string
  /** 提交时间（毫秒） */
  date: number
  /** 标题行 */
  subject: string
  /** 指向该提交的本地分支 */
  branches: string[]
  /** 指向该提交的远程分支 */
  remotes: string[]
  /** 指向该提交的标签 */
  tags: string[]
  /** 是否为当前 HEAD 所在提交 */
  current: boolean
}

export interface GitGraph {
  commits: GitCommitNode[]
  /** 当前分支名 */
  branch: string
  /** 是否处于分离头指针 */
  detached: boolean
  /** 命中的提交总数 */
  total: number
  /** 是否因为超出上限被截断 */
  truncated: boolean
}

/** 单个提交里某个文件的改动 */
export interface GitCommitFile {
  /** 路径（正斜杠） */
  path: string
  /** 重命名 / 复制前的路径 */
  originalPath?: string
  /** 新增行数 */
  added: number
  /** 删除行数 */
  deleted: number
  /** 变更类型：A 新增 / M 修改 / D 删除 / R 重命名 / C 复制 */
  status: string
  /** 二进制文件没有行数统计 */
  binary: boolean
}

/** 展开某个提交时展示的详情 */
export interface GitCommitDetail {
  sha: string
  shortSha: string
  subject: string
  /** 提交正文 */
  body: string
  author: string
  authorEmail: string
  date: number
  parents: string[]
  branches: string[]
  remotes: string[]
  tags: string[]
  files: GitCommitFile[]
  totalAdded: number
  totalDeleted: number
}
