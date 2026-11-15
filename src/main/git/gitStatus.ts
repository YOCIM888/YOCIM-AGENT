import type { GitFileChange } from '../../shared/git'

export interface ParsedGitStatus {
  branch: string
  detached: boolean
  initial: boolean
  upstream: string | null
  ahead: number
  behind: number
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: GitFileChange[]
  conflicted: GitFileChange[]
}

/** 按空格切出前 count 个字段，剩余部分整体作为最后一个字段（路径可能含空格） */
function splitFields(line: string, count: number): string[] {
  const fields: string[] = []
  let rest = line
  for (let index = 0; index < count; index += 1) {
    const space = rest.indexOf(' ')
    if (space < 0) {
      fields.push(rest)
      rest = ''
      break
    }
    fields.push(rest.slice(0, space))
    rest = rest.slice(space + 1)
  }
  fields.push(rest)
  return fields
}

/** git 对含特殊字符的路径会加引号并按字节做 C 风格转义，这里还原为 UTF-8 字符串 */
export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw
  const inner = raw.slice(1, -1)
  const bytes: number[] = []
  const simpleEscapes: Record<string, number> = {
    a: 0x07,
    b: 0x08,
    f: 0x0c,
    n: 0x0a,
    r: 0x0d,
    t: 0x09,
    v: 0x0b,
    '"': 0x22,
    '\\': 0x5c
  }

  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index]
    if (character !== '\\') {
      bytes.push(...Buffer.from(character, 'utf8'))
      continue
    }
    const next = inner[index + 1]
    if (next === undefined) break
    index += 1
    if (next in simpleEscapes) {
      bytes.push(simpleEscapes[next])
      continue
    }
    if (/[0-7]/.test(next)) {
      const octal = inner.slice(index, index + 3)
      if (/^[0-7]{3}$/.test(octal)) {
        bytes.push(Number.parseInt(octal, 8))
        index += 2
        continue
      }
    }
    bytes.push(...Buffer.from(next, 'utf8'))
  }

  return Buffer.from(bytes).toString('utf8')
}

function toChange(
  xy: string,
  path: string,
  options: { originalPath?: string; conflict?: boolean } = {}
): GitFileChange {
  return {
    path,
    ...(options.originalPath ? { originalPath: options.originalPath } : {}),
    indexStatus: xy[0] ?? '.',
    worktreeStatus: xy[1] ?? '.',
    ...(options.conflict ? { conflict: true } : {})
  }
}

/**
 * 解析 `git status --porcelain=v2 --branch --untracked-files=all -- .` 的输出。
 * 调用方需带 `-c core.quotePath=false` 与 `-- .`，保证路径为工作区相对路径。
 */
export function parseGitStatus(stdout: string): ParsedGitStatus {
  const parsed: ParsedGitStatus = {
    branch: '',
    detached: false,
    initial: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: []
  }

  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue

    if (line.startsWith('# ')) {
      const header = line.slice(2)
      if (header.startsWith('branch.oid ')) {
        parsed.initial = header.slice('branch.oid '.length).trim() === '(initial)'
        continue
      }
      if (header.startsWith('branch.head ')) {
        const head = header.slice('branch.head '.length).trim()
        parsed.detached = head === '(detached)'
        parsed.branch = parsed.detached ? '' : head
        continue
      }
      if (header.startsWith('branch.upstream ')) {
        parsed.upstream = header.slice('branch.upstream '.length).trim() || null
        continue
      }
      if (header.startsWith('branch.ab ')) {
        const match = /\+(\d+)\s+-(\d+)/.exec(header)
        if (match) {
          parsed.ahead = Number(match[1])
          parsed.behind = Number(match[2])
        }
        continue
      }
      continue
    }

    const kind = line[0]
    if (kind === '?') {
      const path = unquoteGitPath(line.slice(2))
      if (path) parsed.untracked.push(toChange('??', path))
      continue
    }
    if (kind === '!') continue

    if (kind === '1') {
      const fields = splitFields(line, 8)
      const xy = fields[1] ?? '..'
      const path = unquoteGitPath(fields[8] ?? '')
      if (!path) continue
      if (xy[0] !== '.') parsed.staged.push(toChange(xy, path))
      if (xy[1] !== '.') parsed.unstaged.push(toChange(xy, path))
      continue
    }

    if (kind === '2') {
      const fields = splitFields(line, 9)
      const xy = fields[1] ?? '..'
      const [rawPath, rawOriginal] = (fields[9] ?? '').split('\t')
      const path = unquoteGitPath(rawPath ?? '')
      if (!path) continue
      const originalPath = rawOriginal ? unquoteGitPath(rawOriginal) : undefined
      const change = toChange(xy, path, originalPath ? { originalPath } : {})
      if (xy[0] !== '.') parsed.staged.push(change)
      if (xy[1] !== '.') parsed.unstaged.push(change)
      continue
    }

    if (kind === 'u') {
      const fields = splitFields(line, 10)
      const xy = fields[1] ?? 'UU'
      const path = unquoteGitPath(fields[10] ?? '')
      if (!path) continue
      parsed.conflicted.push(toChange(xy, path, { conflict: true }))
    }
  }

  return parsed
}
