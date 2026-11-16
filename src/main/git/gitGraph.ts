import type { GitCommitFile, GitCommitNode } from '../../shared/git'

/** 字段分隔符（ASCII Unit Separator） */
export const FIELD_SEP = '\x1f'
/** 记录分隔符（ASCII Record Separator） */
export const RECORD_SEP = '\x1e'

export interface ParsedRefs {
  branches: string[]
  remotes: string[]
  tags: string[]
  /** HEAD 是否指向该提交 */
  head: boolean
}

/**
 * 解析 `git log --pretty=format:...` 的 `%D` 字段。
 *
 * 形如 `HEAD -> master, origin/main, tag: v1.0`：
 * - `HEAD -> x` 说明 HEAD 指向本地分支 x；
 * - 带 `/` 的是远程分支；
 * - `tag:` 前缀的是标签。
 */
export function parseRefNames(raw: string): ParsedRefs {
  const result: ParsedRefs = { branches: [], remotes: [], tags: [], head: false }
  const text = raw.trim()
  if (!text) return result
  for (const item of text.split(',')) {
    const name = item.trim()
    if (!name) continue
    if (name.startsWith('HEAD ->')) {
      result.head = true
      const branch = name.slice('HEAD ->'.length).trim()
      if (branch && !result.branches.includes(branch)) result.branches.push(branch)
      continue
    }
    if (name === 'HEAD') {
      result.head = true
      continue
    }
    if (name.startsWith('tag:')) {
      const tag = name.slice('tag:'.length).trim()
      if (tag && !result.tags.includes(tag)) result.tags.push(tag)
      continue
    }
    if (name.includes('/')) {
      if (!result.remotes.includes(name)) result.remotes.push(name)
      continue
    }
    if (!result.branches.includes(name)) result.branches.push(name)
  }
  return result
}

/**
 * 解析提交列表。
 *
 * 每条记录用 RECORD_SEP 结尾，字段之间用 FIELD_SEP 分隔：
 * `%H %h %P %an %ae %at %s %D`
 */
export function parseCommitLog(output: string, headSha = ''): GitCommitNode[] {
  const commits: GitCommitNode[] = []
  for (const record of output.split(RECORD_SEP)) {
    const trimmed = record.replace(/^\n+/, '').trim()
    if (!trimmed) continue
    const fields = trimmed.split(FIELD_SEP)
    if (fields.length < 8) continue
    const [sha, shortSha, parents, author, authorEmail, at, subject, refNames] = fields
    if (!sha) continue
    const refs = parseRefNames(refNames ?? '')
    const timestamp = Number(at)
    commits.push({
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      parents: parents ? parents.trim().split(/\s+/).filter(Boolean) : [],
      author: author ?? '',
      authorEmail: authorEmail ?? '',
      date: Number.isFinite(timestamp) ? timestamp * 1000 : 0,
      subject: subject ?? '',
      branches: refs.branches,
      remotes: refs.remotes,
      tags: refs.tags,
      current: sha === headSha || refs.head
    })
  }
  return commits
}

/**
 * 解析 `git show --numstat -z` 的输出。
 *
 * 普通文件：`added\tdeleted\tpath\0`
 * 重命名/复制：`added\tdeleted\t\0oldPath\0newPath\0`
 * 二进制文件：行数是 `-`。
 */
export function parseNumstat(output: string): GitCommitFile[] {
  const files: GitCommitFile[] = []
  const parts = output.split('\0')
  let index = 0
  while (index < parts.length) {
    const chunk = parts[index]
    index += 1
    if (!chunk) continue
    const tabs = chunk.split('\t')
    const addedRaw = tabs[0] ?? ''
    const deletedRaw = tabs[1] ?? ''
    const path = tabs[2] ?? ''
    if (path === '') {
      // 重命名：后两段分别是旧路径与新路径
      const originalPath = parts[index] ?? ''
      const newPath = parts[index + 1] ?? ''
      index += 2
      if (!newPath) continue
      files.push({
        path: newPath,
        originalPath: originalPath || undefined,
        added: toCount(addedRaw),
        deleted: toCount(deletedRaw),
        status: 'R',
        binary: addedRaw === '-' || deletedRaw === '-'
      })
      continue
    }
    files.push({
      path,
      added: toCount(addedRaw),
      deleted: toCount(deletedRaw),
      status: 'M',
      binary: addedRaw === '-' || deletedRaw === '-'
    })
  }
  return files
}

function toCount(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 从 `git show --name-status -z` 推断每个文件的状态字符。
 * 单独跑一次是因为 numstat 不带类型信息。
 */
export function parseNameStatus(output: string): Map<string, string> {
  const result = new Map<string, string>()
  const parts = output.split('\0')
  let index = 0
  while (index < parts.length) {
    const code = parts[index]
    index += 1
    if (!code) continue
    if (code.startsWith('R') || code.startsWith('C')) {
      // 重命名/复制：后两段是旧路径与新路径，状态挂在新路径上
      const newPath = parts[index + 1] ?? ''
      index += 2
      if (newPath) result.set(newPath, code[0])
      continue
    }
    const path = parts[index] ?? ''
    index += 1
    if (path) result.set(path, code[0])
  }
  return result
}
