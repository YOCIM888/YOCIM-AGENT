import type { ToolExecutionOutcome } from '../../shared/agent'
import { AppError } from '../../shared/errors'
import type { SearchEngine, SearchMatch, SearchQuery } from '../../shared/ipc'
import { SEARCH_LIMITS } from '../../shared/ipc'
import type { WorkspaceGuardLike } from '../workspace/pathGuard'
import { compileSearchRegex } from '../workspace/searchCore'
import type { SearchService } from '../workspace/searchService'
import type { SearchFilesArgs } from './toolSchemas'
import type { ToolFileIo } from './toolFileIo'

const MAX_RESULT_CHARS = 16 * 1024

export interface ToolSearchFile {
  relativePath: string
  matches: SearchMatch[]
}

export interface ToolSearchResult {
  engine: SearchEngine
  files: ToolSearchFile[]
  truncated: boolean
  totalMatches: number
}

/**
 * 搜索执行器由主进程注入（内部复用 SearchService，与搜索面板同一套 ripgrep / 内置引擎，
 * 远程工作区自动走远端 rg）。工具层只负责把结果渲染成模型友好的文本。
 */
export type ToolSearchRunner = (
  query: SearchQuery,
  signal: AbortSignal
) => Promise<ToolSearchResult>

/**
 * 把流式的 SearchService 收敛成一次性结果。
 * 工具调用不需要增量结果，等 done 事件一次性返回即可；
 * 复用同一个服务意味着 ripgrep 探测、远程分支与结果上限逻辑都与搜索面板一致。
 */
export function createSearchServiceRunner(searchService: SearchService): ToolSearchRunner {
  return (query, signal) =>
    new Promise<ToolSearchResult>((resolve, reject) => {
      const files: ToolSearchFile[] = []
      let engine: SearchEngine = 'builtin'
      let truncated = false
      let totalMatches = 0
      let settled = false
      let searchId = ''

      const finish = (result: ToolSearchResult): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
      const onAbort = (): void => {
        if (searchId) searchService.cancel(searchId)
        finish({ engine, files, truncated: true, totalMatches })
      }
      signal.addEventListener('abort', onAbort, { once: true })

      void searchService
        .start(query, (event) => {
          switch (event.kind) {
            case 'file':
              if (event.file) {
                files.push(event.file)
                totalMatches += event.file.matches.length
              }
              break
            case 'done':
              truncated = event.truncated ?? false
              finish({ engine, files, truncated, totalMatches })
              break
            case 'cancelled':
              finish({ engine, files, truncated: true, totalMatches })
              break
            case 'error':
              fail(new AppError('E_IO', event.message ?? '搜索失败'))
              break
          }
        })
        .then((started) => {
          searchId = started.searchId
          engine = started.engine
          if (settled) return
          if (signal.aborted) onAbort()
        })
        .catch((error: unknown) => {
          fail(error instanceof Error ? error : new Error('搜索启动失败'))
        })
    })
}

function buildQuery(args: SearchFilesArgs): SearchQuery {
  // 先本地编译一次正则：非法表达式在这里就报中文错误，不用等 rg 子进程失败
  if (args.regex) {
    compileSearchRegex({
      query: args.query,
      useRegex: true,
      caseSensitive: args.caseSensitive,
      wholeWord: args.wholeWord
    })
  }
  // 搜索服务不支持子目录参数：没有用户 include 时用 glob 收窄，结果侧再按前缀兜底过滤
  const scopeGlob = args.relativePath ? `${args.relativePath.replace(/\/+$/, '')}/**` : ''
  const include = args.include || scopeGlob
  return {
    query: args.query,
    replaceText: '',
    caseSensitive: args.caseSensitive,
    wholeWord: args.wholeWord,
    useRegex: args.regex,
    preserveCase: false,
    include,
    exclude: args.exclude,
    includeIgnored: false,
    onlyOpenEditors: false,
    openFiles: [],
    maxResults: Math.min(args.maxResults, SEARCH_LIMITS.maxResults)
  }
}

function inScope(relativePath: string, scope: string): boolean {
  if (!scope) return true
  const prefix = scope.replace(/\/+$/, '')
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`)
}

function renderFlat(files: ToolSearchFile[]): string[] {
  const lines: string[] = []
  for (const file of files) {
    for (const match of file.matches) {
      lines.push(`${file.relativePath}:${match.line}:${match.column}: ${match.lineText}`)
    }
  }
  return lines
}

async function renderWithContext(
  io: ToolFileIo,
  files: ToolSearchFile[],
  contextLines: number
): Promise<string[]> {
  const blocks: string[] = []
  for (const file of files) {
    const content = await io.peek(file.relativePath)
    if (content === null) {
      // 读不到内容（二进制/过大/远程）时退回单行格式
      blocks.push(...renderFlat([file]))
      continue
    }
    const lines = content.split('\n')
    const hits = new Map<number, SearchMatch>()
    for (const match of file.matches) {
      if (!hits.has(match.line)) hits.set(match.line, match)
    }
    blocks.push(`${file.relativePath}`)
    const emitted = new Set<number>()
    for (const lineNumber of [...hits.keys()].sort((a, b) => a - b)) {
      const from = Math.max(1, lineNumber - contextLines)
      const to = Math.min(lines.length, lineNumber + contextLines)
      for (let line = from; line <= to; line += 1) {
        if (emitted.has(line)) continue
        emitted.add(line)
        const prefix = line === lineNumber ? '>' : ' '
        blocks.push(`${prefix}${String(line).padStart(4, ' ')}| ${lines[line - 1] ?? ''}`)
      }
    }
    blocks.push('')
  }
  return blocks
}

export async function runSearchFiles(
  guard: WorkspaceGuardLike,
  io: ToolFileIo,
  args: SearchFilesArgs,
  runner: ToolSearchRunner,
  signal: AbortSignal
): Promise<ToolExecutionOutcome> {
  const scope = args.relativePath.replace(/^\/+|\/+$/g, '')
  // 先用守卫校验范围路径：越界或不存在时立刻报错，不要让模型对空结果猜测
  if (scope) await guard.resolve(scope, { mustExist: true })
  const query = buildQuery({ ...args, relativePath: scope })

  const result = await runner(query, signal)
  const files = scope
    ? result.files.filter((file) => inScope(file.relativePath, scope))
    : result.files
  const totalMatches = files.reduce((sum, file) => sum + file.matches.length, 0)

  const where = scope ? `${scope} 内` : '工作区'
  if (!totalMatches) {
    return {
      ok: true,
      content: `${where}未找到匹配「${args.query}」。可尝试放宽 include/exclude、关闭大小写区分，或换一个更短的关键词。`,
      summary: `搜索「${args.query}」：0 条结果`
    }
  }

  const rendered =
    args.contextLines > 0
      ? await renderWithContext(io, files, args.contextLines)
      : renderFlat(files)

  const hints: string[] = []
  if (result.truncated) {
    hints.push(
      '[结果已达到上限并截断：请用 include/exclude、relativePath 或更精确的 query 收窄范围]'
    )
  }
  if (result.engine === 'builtin') {
    hints.push('[未找到 ripgrep，已回退内置搜索：结果一致，但大仓库下速度较慢]')
  }

  let content = [...rendered, ...hints].join('\n')
  if (content.length > MAX_RESULT_CHARS) {
    content = `${content.slice(0, MAX_RESULT_CHARS)}\n[结果文本已截断：请收窄搜索范围]`
  }

  return {
    ok: true,
    content,
    summary: `搜索「${args.query}」：${totalMatches} 条结果 / ${files.length} 个文件（${result.engine}）`
  }
}
