import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import {
  SEARCH_LIMITS,
  type ReplaceFileResult,
  type SearchEngine,
  type SearchEvent,
  type SearchMatch,
  type SearchQuery,
  type SearchReplaceRequest,
  type SearchReplaceResult,
  type SearchStartResult
} from '../../shared/ipc'
import type { TimelineService } from './timelineService'
import type { WorkspaceGuardLike } from './pathGuard'
import {
  findRipgrepPath,
  parseRipgrepJson,
  ripgrepSubmatchesToMatches,
  type RipgrepJsonEvent
} from './ripgrep'
import { getRemoteExec, type RemoteExec } from '../remote/execRegistry'
import {
  applyEol,
  buildRipgrepArgs,
  applyReplacements,
  findMatches,
  hashContent,
  isGitIgnored,
  isNoiseDirectory,
  lineAfterReplacement,
  matchesFileFilters,
  normalizeEol,
  parseGitignore,
  type GitIgnoreRule
} from './searchCore'

interface SearchSession {
  id: string
  query: SearchQuery
  engine: SearchEngine
  rgPath: string | null
  emit: (event: SearchEvent) => void
  cancelled: boolean
  seq: number
  totalMatches: number
  totalFiles: number
  truncated: boolean
  finished: boolean
  child?: ChildProcess
  /** 远程搜索的取消入口（WSL/SSH 命令不是本地子进程） */
  remoteCancel?: () => void
}

export interface SearchServiceDeps {
  getGuard: () => WorkspaceGuardLike
  /** 仅在批量替换时用于生成快照；Agent 搜索等只读场景可以不提供 */
  timeline?: TimelineService
  findRg?: () => Promise<string | null>
}

type EventPayload = Omit<SearchEvent, 'searchId' | 'seq' | 'engine'>

function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message
  return error instanceof Error ? error.message : '搜索失败'
}

export class SearchService {
  private readonly sessions = new Map<string, SearchSession>()

  constructor(private readonly deps: SearchServiceDeps) {}

  async start(query: SearchQuery, emit: (event: SearchEvent) => void): Promise<SearchStartResult> {
    const remote = getRemoteExec()
    if (remote && query.onlyOpenEditors) {
      throw new AppError('E_UNSUPPORTED', '远程工作区暂不支持「仅在打开的文件中搜索」')
    }
    const findRg = this.deps.findRg ?? findRipgrepPath
    // 远程搜索固定用远端的 rg：本地探测没有意义
    const rgPath = remote ? 'rg' : query.onlyOpenEditors ? null : await findRg()
    const session: SearchSession = {
      id: randomUUID(),
      query,
      engine: rgPath ? 'ripgrep' : 'builtin',
      rgPath,
      emit,
      cancelled: false,
      seq: 0,
      totalMatches: 0,
      totalFiles: 0,
      truncated: false,
      finished: false
    }
    this.sessions.set(session.id, session)
    // 下一个事件循环再开始，确保 search:start 的返回值先于首个事件抵达 renderer
    setImmediate(() => {
      void this.run(session)
    })
    return { searchId: session.id, engine: session.engine }
  }

  cancel(searchId: string): { cancelled: boolean } {
    const session = this.sessions.get(searchId)
    if (!session || session.finished) return { cancelled: false }
    session.cancelled = true
    session.child?.kill()
    session.remoteCancel?.()
    this.send(session, { kind: 'cancelled' })
    this.complete(session, 'cancelled')
    return { cancelled: true }
  }

  private send(session: SearchSession, payload: EventPayload): void {
    if (session.finished && payload.kind !== 'done' && payload.kind !== 'error') return
    session.emit({ ...payload, searchId: session.id, seq: session.seq++, engine: session.engine })
  }

  private complete(session: SearchSession, kind: 'done' | 'error' | 'cancelled'): void {
    if (session.finished) return
    session.finished = true
    this.send(session, {
      kind: 'done',
      totalMatches: session.totalMatches,
      totalFiles: session.totalFiles,
      truncated: session.truncated,
      ...(kind === 'cancelled' ? { message: '已取消' } : {})
    })
    this.sessions.delete(session.id)
  }

  private async run(session: SearchSession): Promise<void> {
    try {
      const remote = getRemoteExec()
      if (remote) {
        await this.runRipgrepRemote(session, remote)
      } else if (session.engine === 'ripgrep' && session.rgPath) {
        await this.runRipgrep(session, session.rgPath)
      } else {
        await this.runBuiltin(session)
      }
      this.complete(session, session.cancelled ? 'cancelled' : 'done')
    } catch (error) {
      this.send(session, { kind: 'error', message: errorMessage(error) })
      this.complete(session, 'error')
    }
  }

  private async processFile(session: SearchSession, relativePath: string): Promise<void> {
    if (session.cancelled || session.truncated) return
    let absolutePath: string
    try {
      const resolved = await this.deps.getGuard().resolve(relativePath, { mustExist: true })
      absolutePath = resolved.absolutePath
      const info = await stat(absolutePath)
      if (!info.isFile() || info.size > SEARCH_LIMITS.maxFileBytes) return
    } catch {
      return
    }
    let raw: Buffer
    try {
      raw = await readFile(absolutePath)
    } catch {
      return
    }
    // 跳过二进制文件（含 NUL 字节）
    if (raw.includes(0)) return
    const content = normalizeEol(raw.toString('utf8')).content
    let matches = findMatches(content, session.query, SEARCH_LIMITS.maxMatchesPerFile)
    if (!matches.length) return
    const remaining = session.query.maxResults - session.totalMatches
    if (matches.length > remaining) {
      matches = matches.slice(0, Math.max(0, remaining))
      session.truncated = true
    }
    if (!matches.length) return
    this.send(session, {
      kind: 'file',
      file: { relativePath, contentHash: hashContent(content), matches }
    })
    session.totalMatches += matches.length
    session.totalFiles += 1
    if (session.totalMatches >= session.query.maxResults) session.truncated = true
  }

  private async runBuiltin(session: SearchSession): Promise<void> {
    const root = this.deps.getGuard().root
    const query = session.query

    if (query.onlyOpenEditors) {
      let scanned = 0
      for (const relativePath of new Set(query.openFiles)) {
        if (session.cancelled || session.truncated) return
        if (!matchesFileFilters(relativePath, query)) continue
        await this.processFile(session, relativePath)
        scanned += 1
        if (scanned % 8 === 0) await new Promise((resolve) => setImmediate(resolve))
      }
      return
    }

    const walk = async (
      absoluteDir: string,
      relativeDir: string,
      inherited: GitIgnoreRule[]
    ): Promise<void> => {
      if (session.cancelled || session.truncated) return
      let rules = inherited
      if (!query.includeIgnored) {
        try {
          rules = [
            ...inherited,
            ...parseGitignore(
              await readFile(path.join(absoluteDir, '.gitignore'), 'utf8'),
              relativeDir
            )
          ]
        } catch {
          // 无 .gitignore：沿用上层规则
        }
      }
      let entries
      try {
        entries = await readdir(absoluteDir, { withFileTypes: true })
      } catch {
        return
      }
      let scanned = 0
      for (const entry of entries) {
        if (session.cancelled || session.truncated) return
        // 符号链接不跟随，避免越出工作区
        if (entry.isSymbolicLink()) continue
        const isDir = entry.isDirectory()
        if (!isDir && !entry.isFile()) continue
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
        if (!query.includeIgnored) {
          if (isDir && isNoiseDirectory(entry.name)) continue
          if (isGitIgnored(relativePath, rules, isDir)) continue
        }
        if (isDir) {
          await walk(path.join(absoluteDir, entry.name), relativePath, rules)
          continue
        }
        if (!matchesFileFilters(relativePath, query)) continue
        await this.processFile(session, relativePath)
        scanned += 1
        // 定期让出事件循环，大仓库搜索不阻塞主进程 / UI
        if (scanned % 16 === 0) await new Promise((resolve) => setImmediate(resolve))
      }
    }

    await walk(root, '', [])
  }

  private async runRipgrep(session: SearchSession, rgPath: string): Promise<void> {
    const root = this.deps.getGuard().root
    const args = buildRipgrepArgs(session.query)
    if (session.query.onlyOpenEditors) args.push('--', ...session.query.openFiles)
    const child = spawn(rgPath, args, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    session.child = child

    const matched = new Set<string>()
    let pending: Promise<void> = Promise.resolve()
    let buffer = ''
    let stderr = ''
    let spawnError: unknown = null

    const handleLine = (line: string): void => {
      if (!line.trim() || session.cancelled) return
      const record = parseRipgrepJson(line, root)
      if (record.kind === 'match') matched.add(record.relativePath)
      if (record.kind === 'end' && matched.has(record.relativePath)) {
        const relativePath = record.relativePath
        pending = pending.then(() => this.processFile(session, relativePath)).catch(() => undefined)
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        handleLine(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-1000)
    })
    child.on('error', (error) => {
      spawnError = error
    })

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code))
    })
    if (buffer.trim()) handleLine(buffer)
    await pending
    if (session.cancelled) return
    if (spawnError || (exitCode !== null && exitCode > 1)) {
      const message = spawnError
        ? errorMessage(spawnError)
        : stderr.trim().slice(0, 300) || 'ripgrep 执行失败'
      this.send(session, { kind: 'error', message })
    }
  }

  /** 远程工作区：直接解析远端 rg 的 JSON 事件，不再回读文件（省一次往返） */
  private async runRipgrepRemote(session: SearchSession, remote: RemoteExec): Promise<void> {
    const args = buildRipgrepArgs(session.query)
    const matched = new Map<string, SearchMatch[]>()
    let stderr = ''

    const flush = (relativePath: string): void => {
      const matches = matched.get(relativePath)
      matched.delete(relativePath)
      if (!matches?.length || session.cancelled || session.truncated) return
      const remaining = session.query.maxResults - session.totalMatches
      const limited =
        matches.length > remaining ? matches.slice(0, Math.max(0, remaining)) : matches
      if (matches.length > remaining) session.truncated = true
      if (!limited.length) {
        session.truncated = true
        return
      }
      this.send(session, {
        kind: 'file',
        file: { relativePath, contentHash: '', matches: limited }
      })
      session.totalMatches += limited.length
      session.totalFiles += 1
      if (session.totalMatches >= session.query.maxResults) session.truncated = true
    }

    const handle = remote.stream('rg', args, {
      cwd: remote.rootPath,
      onLine: (line) => {
        let event: RipgrepJsonEvent
        try {
          event = JSON.parse(line) as RipgrepJsonEvent
        } catch {
          return
        }
        const relativePath = event.data?.path?.text
        if (!relativePath) return
        const clean = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
        if (event.type === 'match') {
          const matches = ripgrepSubmatchesToMatches(event, session.query)
          if (!matches.length) return
          matched.set(clean, [...(matched.get(clean) ?? []), ...matches])
        } else if (event.type === 'end') {
          flush(clean)
        }
      },
      onStderr: (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-1000)
      }
    })
    session.remoteCancel = handle.cancel

    const { code, stderr: tail } = await handle.done
    for (const relativePath of [...matched.keys()]) flush(relativePath)
    if (session.cancelled) return
    const message = (tail || stderr).trim()
    if (code !== 0 && code !== 1) {
      this.send(session, {
        kind: 'error',
        message: /not found|command not found/i.test(message)
          ? '远端未安装 ripgrep，请先在远程环境安装（例如 sudo apt install ripgrep）'
          : message.slice(0, 300) || '远端搜索失败'
      })
    }
  }

  async replace(request: SearchReplaceRequest): Promise<SearchReplaceResult> {
    if (getRemoteExec()) {
      throw new AppError('E_UNSUPPORTED', '远程工作区暂不支持批量替换，请在远程终端中执行')
    }
    const timeline = this.deps.timeline
    if (!timeline) {
      throw new AppError('E_UNSUPPORTED', '当前未启用文件历史，无法批量替换')
    }
    const guard = this.deps.getGuard()
    const targets =
      request.scope === 'single' ? (request.target ? [request.target] : []) : request.files
    const files: ReplaceFileResult[] = []
    const conflicts: string[] = []
    let totalReplaced = 0

    for (const target of targets) {
      let resolved
      try {
        resolved = await guard.resolve(target.relativePath, { mustExist: true })
        const info = await stat(resolved.absolutePath)
        if (!info.isFile()) throw new AppError('E_INVALID_INPUT', '目标不是文件')
        if (info.size > SEARCH_LIMITS.maxFileBytes) throw new AppError('E_TOO_LARGE', '文件过大')
      } catch {
        files.push({
          relativePath: target.relativePath,
          status: 'skipped',
          replaced: 0,
          previews: []
        })
        continue
      }

      let raw: string
      try {
        raw = await readFile(resolved.absolutePath, 'utf8')
      } catch {
        files.push({
          relativePath: target.relativePath,
          status: 'skipped',
          replaced: 0,
          previews: []
        })
        continue
      }
      const { content, eol } = normalizeEol(raw)
      const currentHash = hashContent(content)
      // 搜索后文件被外部修改：拒绝覆盖，要求重新搜索
      if (target.hash && currentHash !== target.hash) {
        conflicts.push(target.relativePath)
        await timeline.snapshot({
          workspaceRoot: guard.root,
          relativePath: target.relativePath,
          source: 'external',
          content
        })
        files.push({
          relativePath: target.relativePath,
          status: 'conflict',
          replaced: 0,
          previews: []
        })
        continue
      }

      const all = findMatches(content, request.query, SEARCH_LIMITS.maxMatchesPerFile)
      const selected: SearchMatch[] =
        request.scope === 'single'
          ? all
              .filter((match) => match.line === target.line && match.column === target.column)
              .slice(0, 1)
          : all
      const previewLines = [...new Set(selected.map((match) => match.line))].slice(0, 5)
      const previews = previewLines.map((line) => ({
        line,
        before: selected.find((match) => match.line === line)?.lineText ?? '',
        after: lineAfterReplacement(
          content,
          line,
          selected.filter((match) => match.line === line)
        )
      }))

      if (!request.apply || !selected.length) {
        // 预览阶段 replaced 表示「预计替换数」，applied=false 时 UI 显示为「将替换」
        totalReplaced += selected.length
        files.push({
          relativePath: target.relativePath,
          status: selected.length ? 'ok' : 'skipped',
          replaced: selected.length,
          previews
        })
        continue
      }

      // 写入前生成编辑前快照，替换可通过时间线恢复
      await timeline.snapshot({
        workspaceRoot: guard.root,
        relativePath: target.relativePath,
        source: 'user',
        content
      })
      const next = applyReplacements(content, selected)
      await writeFile(resolved.absolutePath, applyEol(next, eol), 'utf8')
      await timeline.snapshot({
        workspaceRoot: guard.root,
        relativePath: target.relativePath,
        source: 'user',
        content: next
      })
      totalReplaced += selected.length
      files.push({
        relativePath: target.relativePath,
        status: 'ok',
        replaced: selected.length,
        previews,
        contentHash: hashContent(next)
      })
    }

    return { files, totalReplaced, conflicts, applied: request.apply }
  }
}
