import { createHash } from 'node:crypto'
import { AppError } from '../../shared/errors'
import {
  IGNORED_DIRECTORIES,
  SEARCH_LIMITS,
  type FileEol,
  type SearchMatch,
  type SearchQuery
} from '../../shared/ipc'

/** 内容 hash 统一基于 LF 归一化文本，避免平台换行差异造成误判。 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function normalizeEol(input: string): { content: string; eol: FileEol } {
  const eol: FileEol = input.includes('\r\n') ? 'crlf' : 'lf'
  return { content: eol === 'crlf' ? input.replace(/\r\n/g, '\n') : input, eol }
}

export function applyEol(content: string, eol: FileEol): string {
  return eol === 'crlf' ? content.replace(/\n/g, '\r\n') : content
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 构造行内匹配正则；固定字符串与全词模式都在主进程侧统一处理，renderer 只传意图。 */
export function compileSearchRegex(
  query: Pick<SearchQuery, 'query' | 'useRegex' | 'caseSensitive' | 'wholeWord'>
): RegExp {
  const source = query.useRegex ? query.query : escapeRegExp(query.query)
  const wrapped = query.wholeWord ? `(?<![\\w$])(?:${source})(?![\\w$])` : source
  try {
    return new RegExp(wrapped, `g${query.caseSensitive ? '' : 'i'}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    throw new AppError('E_INVALID_INPUT', `正则表达式不合法：${detail}`)
  }
}

function expandCaptureGroups(match: RegExpExecArray, replacement: string): string {
  return replacement.replace(/\$(\$|&|\d)/g, (_token, key: string) => {
    if (key === '$') return '$'
    if (key === '&') return match[0]
    const index = Number(key)
    return match[index] ?? ''
  })
}

/** 保留大小写：FOO → BAR、Foo → Bar、foo → bar（VS Code 行为）。 */
export function replacementFor(matchText: string, query: SearchQuery): string {
  const raw = query.useRegex
    ? expandCaptureGroups([matchText] as unknown as RegExpExecArray, query.replaceText)
    : query.replaceText
  if (!query.preserveCase || !raw) return raw
  if (matchText === matchText.toUpperCase() && /[A-Z]/.test(matchText)) return raw.toUpperCase()
  if (/^[A-Z]/.test(matchText)) return raw.charAt(0).toUpperCase() + raw.slice(1)
  if (matchText === matchText.toLowerCase()) return raw.toLowerCase()
  return raw
}

function clip(value: string): string {
  const limit = SEARCH_LIMITS.maxLineChars
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/** 按行扫描文本，返回带行列范围与替换文本的命中。 */
export function findMatches(
  content: string,
  query: SearchQuery,
  limit: number = SEARCH_LIMITS.maxMatchesPerFile
): SearchMatch[] {
  const regex = compileSearchRegex(query)
  const lines = content.split('\n')
  const matches: SearchMatch[] = []
  for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
    const lineText = lines[index]
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(lineText)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex += 1
        continue
      }
      matches.push({
        line: index + 1,
        column: match.index + 1,
        endColumn: match.index + 1 + match[0].length,
        lineText: clip(lineText),
        matchText: match[0],
        replaceText: query.useRegex
          ? expandCaptureGroups(match, query.replaceText)
          : replacementFor(match[0], query)
      })
      if (matches.length >= limit) break
      if (regex.lastIndex >= lineText.length) break
    }
  }
  return matches
}

/** 用命中自身的 replaceText 逆序替换，保证同一行的多个命中列号不错位。 */
export function applyReplacements(content: string, matches: SearchMatch[]): string {
  if (!matches.length) return content
  const byLine = new Map<number, SearchMatch[]>()
  for (const match of matches) {
    const list = byLine.get(match.line) ?? []
    list.push(match)
    byLine.set(match.line, list)
  }
  const lines = content.split('\n')
  for (const [lineNumber, lineMatches] of byLine) {
    const index = lineNumber - 1
    if (index < 0 || index >= lines.length) continue
    let line = lines[index]
    const ordered = [...lineMatches].sort((a, b) => b.column - a.column)
    for (const match of ordered) {
      line = `${line.slice(0, match.column - 1)}${match.replaceText}${line.slice(match.endColumn - 1)}`
    }
    lines[index] = line
  }
  return lines.join('\n')
}

export function lineAfterReplacement(
  content: string,
  line: number,
  matches: SearchMatch[]
): string {
  const sourceLine = content.split('\n')[line - 1] ?? ''
  let result = sourceLine
  for (const match of [...matches].sort((a, b) => b.column - a.column)) {
    result = `${result.slice(0, match.column - 1)}${match.replaceText}${result.slice(match.endColumn - 1)}`
  }
  return clip(result)
}

/* ----------------------------- glob / gitignore ---------------------------- */

function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index += 1
        if (pattern[index + 1] === '/') {
          index += 1
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else if (char === '[' || char === ']') {
      source += `\\${char}`
    } else {
      source += char.replace(/[.+^${}()|\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

export function parsePatterns(input: string): string[] {
  return input
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
}

function matchesGlob(relativePath: string, pattern: string): boolean {
  const cleaned = pattern.startsWith('!') ? pattern.slice(1) : pattern
  if (!cleaned) return false
  const regex = globToRegExp(cleaned)
  if (regex.test(relativePath)) return true
  // 不含斜杠的模式按 basename 语义匹配任意层级（与 VS Code 一致）
  if (!cleaned.includes('/')) {
    const name = relativePath.split('/').pop() ?? relativePath
    return regex.test(name)
  }
  return false
}

export function matchesFileFilters(relativePath: string, query: SearchQuery): boolean {
  const include = parsePatterns(query.include)
  const exclude = parsePatterns(query.exclude)
  const included = include.some((pattern) => !pattern.startsWith('!'))
    ? include.some((pattern) => !pattern.startsWith('!') && matchesGlob(relativePath, pattern))
    : true
  if (!included) return false
  const excludedByInclude = include.some(
    (pattern) => pattern.startsWith('!') && matchesGlob(relativePath, pattern.slice(1))
  )
  if (excludedByInclude) return false
  return !exclude.some((pattern) => matchesGlob(relativePath, pattern))
}

export interface GitIgnoreRule {
  base: string
  negated: boolean
  dirOnly: boolean
  anchored: boolean
  matcher: RegExp
}

/**
 * 简化版 .gitignore 解析：支持注释、取反、目录结尾 /、根目录锚定 /、* 与 ** 通配。
 * 子目录 .gitignore 的规则通过 base 限定作用域（不实现完整的 gitignore 规范）。
 */
export function parseGitignore(content: string, base = ''): GitIgnoreRule[] {
  const rules: GitIgnoreRule[] = []
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let pattern = line.startsWith('!') ? line.slice(1) : line
    const negated = line.startsWith('!')
    const dirOnly = pattern.endsWith('/')
    if (dirOnly) pattern = pattern.slice(0, -1)
    const anchored = pattern.startsWith('/') || pattern.includes('/')
    if (anchored && pattern.startsWith('/')) pattern = pattern.slice(1)
    if (!pattern) continue
    rules.push({ base, negated, dirOnly, anchored, matcher: globToRegExp(pattern) })
  }
  return rules
}

function pathSuffixes(relativePath: string): string[] {
  const parts = relativePath.split('/')
  return parts.map((_, index) => parts.slice(index).join('/'))
}

export function isGitIgnored(
  relativePath: string,
  rules: GitIgnoreRule[],
  isDirectory: boolean
): boolean {
  let ignored = false
  for (const rule of rules) {
    if (rule.dirOnly && !isDirectory) continue
    if (rule.base && relativePath !== rule.base && !relativePath.startsWith(`${rule.base}/`))
      continue
    const scoped = rule.base ? relativePath.slice(rule.base.length + 1) : relativePath
    const candidates = rule.anchored ? [scoped] : pathSuffixes(scoped)
    if (candidates.some((candidate) => rule.matcher.test(candidate))) ignored = !rule.negated
  }
  return ignored
}

export function isNoiseDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name) || name === '.git'
}

/** ripgrep 参数构造：纯函数，便于单测覆盖固定串/正则/大小写/glob。 */
export function buildRipgrepArgs(query: SearchQuery): string[] {
  const args = [
    '--json',
    '--line-number',
    '--column',
    '--no-heading',
    '--color',
    'never',
    '--max-filesize',
    `${SEARCH_LIMITS.maxFileBytes}`,
    '--hidden'
  ]
  if (!query.caseSensitive) args.push('-i')
  if (query.wholeWord) args.push('-w')
  if (!query.useRegex) args.push('--fixed-strings')
  if (query.includeIgnored) args.push('--no-ignore')
  for (const pattern of parsePatterns(query.include)) args.push('-g', pattern)
  for (const pattern of parsePatterns(query.exclude)) args.push('-g', `!${pattern}`)
  args.push('-e', query.query)
  return args
}
