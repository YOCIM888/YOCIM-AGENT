import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { SearchMatch, SearchQuery } from '../../shared/ipc'
import { replacementFor } from './searchCore'

const execFileAsync = promisify(execFile)

export type RipgrepRecord =
  { kind: 'begin' | 'match' | 'end'; relativePath: string } | { kind: 'other' }

interface RipgrepJsonEvent {
  type?: string
  data?: {
    path?: { text?: string }
    lines?: { text?: string }
    line_number?: number
    submatches?: Array<{ match?: { text?: string }; start?: number; end?: number }>
  }
}

function relativeFromRoot(root: string, raw: string): string {
  const forward = raw.replace(/\\/g, '/')
  const normalized = path.isAbsolute(raw)
    ? path.relative(root, raw).replace(/\\/g, '/')
    : forward.replace(/^\.\//, '')
  return normalized.replace(/\\/g, '/')
}

/** 解析 `rg --json` 单行；无效 JSON / 非 UTF-8 路径直接忽略。 */
export function parseRipgrepJson(line: string, root: string): RipgrepRecord {
  let parsed: RipgrepJsonEvent
  try {
    parsed = JSON.parse(line) as RipgrepJsonEvent
  } catch {
    return { kind: 'other' }
  }
  const rawPath = parsed.data?.path?.text
  if (!rawPath) return { kind: 'other' }
  if (parsed.type === 'begin' || parsed.type === 'match' || parsed.type === 'end') {
    return { kind: parsed.type, relativePath: relativeFromRoot(root, rawPath) }
  }
  return { kind: 'other' }
}

/** 把 rg 的 submatch 转成统一 SearchMatch（单测覆盖；服务内以统一 matcher 重算为准）。 */
export function ripgrepSubmatchesToMatches(
  event: RipgrepJsonEvent,
  query: SearchQuery
): SearchMatch[] {
  const lineText = (event.data?.lines?.text ?? '').replace(/\r?\n$/, '')
  const line = event.data?.line_number ?? 1
  return (event.data?.submatches ?? []).flatMap((submatch) => {
    const text = submatch.match?.text ?? ''
    if (!text) return []
    const startBytes = submatch.start ?? 0
    const endBytes = submatch.end ?? startBytes + text.length
    const bytes = Buffer.from(lineText, 'utf8')
    const column = bytes.subarray(0, startBytes).toString('utf8').length + 1
    const endColumn = bytes.subarray(0, endBytes).toString('utf8').length + 1
    return [
      {
        line,
        column,
        endColumn,
        lineText,
        matchText: text,
        replaceText: replacementFor(text, query)
      }
    ]
  })
}

/** 打包的 ripgrep 优先；其次环境变量覆盖；最后探测 PATH 里的 rg。 */
export function ripgrepCandidates(): string[] {
  const exe = process.platform === 'win32' ? 'rg.exe' : 'rg'
  const list: string[] = []
  const override = process.env['YOCIM_RIPGREP_PATH']
  if (override) list.push(override)
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resources) list.push(path.join(resources, 'ripgrep', exe))
  list.push(path.join(process.cwd(), 'resources', 'ripgrep', exe))
  return list
}

export async function findRipgrepPath(): Promise<string | null> {
  for (const candidate of ripgrepCandidates()) {
    if (existsSync(candidate)) return candidate
  }
  try {
    await execFileAsync('rg', ['--version'], { timeout: 1500, windowsHide: true })
    return 'rg'
  } catch {
    return null
  }
}
