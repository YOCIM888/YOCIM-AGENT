import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AuditEntry, AuditFilter, AuditPage, AuditStats } from '../../shared/audit'
import type { TimelineSource } from '../../shared/ipc'
import type {
  ProjectSummary,
  SessionSummary,
  StoredMessage,
  StoredMessageRole
} from '../../shared/session'

interface SessionRow {
  id: string
  title: string
  workspace_root: string | null
  project_id: string | null
  pinned_at: number | null
  archived_at: number | null
  created_at: number
  updated_at: number
}

interface ProjectRow {
  id: string
  root: string
  name: string
  created_at: number
  updated_at: number
  session_count: number
  last_session_at: number | null
}

interface MessageRow {
  id: string
  session_id: string
  role: StoredMessageRole
  content: string
  created_at: number
}

interface AuditRow {
  id: string
  session_id: string
  run_id: string
  tool: string
  args_summary: string
  result_summary: string
  approval: AuditEntry['approval']
  ok: number
  ts: number
  call_id: string | null
  duration_ms: number | null
}

function mapSession(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    workspaceRoot: row.workspace_root,
    projectId: row.project_id,
    pinnedAt: row.pinned_at === null ? null : Number(row.pinned_at),
    archivedAt: row.archived_at === null ? null : Number(row.archived_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

function mapProject(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    root: row.root,
    name: row.name,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    sessionCount: Number(row.session_count ?? 0),
    lastSessionAt: row.last_session_at === null ? null : Number(row.last_session_at)
  }
}

function mapMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: Number(row.created_at)
  }
}

function mapAudit(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    ts: Number(row.ts),
    sessionId: row.session_id,
    runId: row.run_id,
    tool: row.tool,
    argsSummary: row.args_summary,
    resultSummary: row.result_summary,
    approval: row.approval,
    ok: row.ok === 1,
    ...(row.call_id ? { callId: row.call_id } : {}),
    ...(row.duration_ms === null || row.duration_ms === undefined
      ? {}
      : { durationMs: Number(row.duration_ms) })
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

interface AuditWhere {
  clause: string
  params: Array<string | number>
}

function buildAuditWhere(filter: AuditFilter): AuditWhere {
  const clauses: string[] = []
  const params: Array<string | number> = []

  if (filter.sessionId) {
    clauses.push('session_id = ?')
    params.push(filter.sessionId)
  }
  if (filter.tool) {
    clauses.push('tool = ?')
    params.push(filter.tool)
  }
  if (typeof filter.ok === 'boolean') {
    clauses.push('ok = ?')
    params.push(filter.ok ? 1 : 0)
  }
  if (filter.approval) {
    clauses.push('approval = ?')
    params.push(filter.approval)
  }
  if (filter.keyword) {
    const like = `%${escapeLike(filter.keyword)}%`
    clauses.push(
      `(tool LIKE ? ESCAPE '\\' OR args_summary LIKE ? ESCAPE '\\' OR result_summary LIKE ? ESCAPE '\\')`
    )
    params.push(like, like, like)
  }
  if (typeof filter.from === 'number') {
    clauses.push('ts >= ?')
    params.push(filter.from)
  }
  if (typeof filter.to === 'number') {
    clauses.push('ts <= ?')
    params.push(filter.to)
  }

  return { clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export class SessionRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(options: { projectId?: string; includeArchived?: boolean } = {}): SessionSummary[] {
    const clauses: string[] = []
    const params: string[] = []
    if (!options.includeArchived) clauses.push('archived_at IS NULL')
    if (options.projectId) {
      clauses.push('project_id = ?')
      params.push(options.projectId)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions ${where}
         ORDER BY (pinned_at IS NULL) ASC, pinned_at DESC, updated_at DESC, created_at DESC`
      )
      .all(...params) as unknown as SessionRow[]
    return rows.map(mapSession)
  }

  get(id: string): SessionSummary | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      SessionRow | undefined
    return row ? mapSession(row) : null
  }

  create(input: {
    title: string
    workspaceRoot: string | null
    projectId: string | null
  }): SessionSummary {
    const now = Date.now()
    const summary: SessionSummary = {
      id: randomUUID(),
      title: input.title,
      workspaceRoot: input.workspaceRoot,
      projectId: input.projectId,
      pinnedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO sessions
         (id, title, workspace_root, project_id, pinned_at, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`
      )
      .run(summary.id, summary.title, summary.workspaceRoot, summary.projectId, now, now)
    return summary
  }

  rename(id: string, title: string): SessionSummary | null {
    this.db
      .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), id)
    return this.get(id)
  }

  setPinned(id: string, pinned: boolean): SessionSummary | null {
    this.db
      .prepare('UPDATE sessions SET pinned_at = ? WHERE id = ?')
      .run(pinned ? Date.now() : null, id)
    return this.get(id)
  }

  setArchived(id: string, archived: boolean): SessionSummary | null {
    this.db
      .prepare('UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(archived ? Date.now() : null, Date.now(), id)
    return this.get(id)
  }

  move(id: string, projectId: string, workspaceRoot: string): SessionSummary | null {
    this.db
      .prepare(
        'UPDATE sessions SET project_id = ?, workspace_root = ?, updated_at = ? WHERE id = ?'
      )
      .run(projectId, workspaceRoot, Date.now(), id)
    return this.get(id)
  }

  touch(id: string, at: number = Date.now()): void {
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(at, id)
  }

  delete(id: string): boolean {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM tool_calls WHERE session_id = ?').run(id)
      const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
      this.db.exec('COMMIT')
      return Number(result.changes) > 0
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

export class ProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.*,
           (SELECT COUNT(*) FROM sessions s
             WHERE s.project_id = p.id AND s.archived_at IS NULL) AS session_count,
           (SELECT MAX(s.updated_at) FROM sessions s
             WHERE s.project_id = p.id AND s.archived_at IS NULL) AS last_session_at
         FROM projects p
         ORDER BY COALESCE(last_session_at, p.updated_at) DESC, p.name ASC`
      )
      .all() as unknown as ProjectRow[]
    return rows.map(mapProject)
  }

  get(id: string): ProjectSummary | null {
    const row = this.db
      .prepare(
        `SELECT p.*,
           (SELECT COUNT(*) FROM sessions s
             WHERE s.project_id = p.id AND s.archived_at IS NULL) AS session_count,
           (SELECT MAX(s.updated_at) FROM sessions s
             WHERE s.project_id = p.id AND s.archived_at IS NULL) AS last_session_at
         FROM projects p WHERE p.id = ?`
      )
      .get(id) as ProjectRow | undefined
    return row ? mapProject(row) : null
  }

  getByRoot(root: string): ProjectSummary | null {
    const row = this.db.prepare('SELECT id FROM projects WHERE root = ?').get(root) as
      { id?: string } | undefined
    return row?.id ? this.get(row.id) : null
  }

  ensure(root: string): ProjectSummary {
    const existing = this.getByRoot(root)
    if (existing) return existing

    const now = Date.now()
    const id = randomUUID()
    this.db
      .prepare(
        'INSERT INTO projects (id, root, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, root, basename(root) || root, now, now)
    return this.get(id) as ProjectSummary
  }

  rename(id: string, name: string): ProjectSummary | null {
    this.db
      .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, Date.now(), id)
    return this.get(id)
  }

  touch(id: string, at: number = Date.now()): void {
    this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(at, id)
  }
}

export class MessageRepository {
  constructor(private readonly db: DatabaseSync) {}

  listBySession(sessionId: string): StoredMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC')
      .all(sessionId) as unknown as MessageRow[]
    return rows.map(mapMessage)
  }

  insert(message: StoredMessage & { sessionId: string }): void {
    this.db
      .prepare(
        'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(message.id, message.sessionId, message.role, message.content, message.createdAt)
  }

  countBySession(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?')
      .get(sessionId) as { count?: number } | undefined
    return Number(row?.count ?? 0)
  }
}

export interface ToolCallRecord {
  id: string
  sessionId: string
  runId: string
  callId: string
  tool: string
  argsSummary: string
  resultSummary: string
  approval: string
  status: 'success' | 'failed'
  createdAt: number
}

export class ToolCallRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(record: ToolCallRecord): void {
    this.db
      .prepare(
        `INSERT INTO tool_calls
         (id, session_id, run_id, call_id, tool, args_summary, result_summary, approval, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.sessionId,
        record.runId,
        record.callId,
        record.tool,
        record.argsSummary,
        record.resultSummary,
        record.approval,
        record.status,
        record.createdAt
      )
  }

  countBySession(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM tool_calls WHERE session_id = ?')
      .get(sessionId) as { count?: number } | undefined
    return Number(row?.count ?? 0)
  }
}

export class SettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(key: string): unknown {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      { value_json?: string } | undefined
    if (!row?.value_json) return undefined
    try {
      return JSON.parse(row.value_json) as unknown
    } catch {
      return undefined
    }
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
      )
      .run(key, JSON.stringify(value))
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  }
}

export class AuditRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(entry: AuditEntry): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs
         (id, session_id, run_id, tool, args_summary, result_summary, approval, ok, ts, call_id, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.sessionId,
        entry.runId,
        entry.tool,
        entry.argsSummary,
        entry.resultSummary,
        entry.approval,
        entry.ok ? 1 : 0,
        entry.ts,
        entry.callId ?? null,
        typeof entry.durationMs === 'number' ? Math.round(entry.durationMs) : null
      )
  }

  list(options: { sessionId?: string; limit?: number } = {}): AuditEntry[] {
    return this.query({ sessionId: options.sessionId }, 1, options.limit ?? 50).entries
  }

  query(filter: AuditFilter, page = 1, pageSize = 50): AuditPage {
    const where = buildAuditWhere(filter)
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where.clause}`)
      .get(...where.params) as { count?: number } | undefined
    const total = Number(totalRow?.count ?? 0)
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_logs ${where.clause} ORDER BY ts DESC, rowid DESC LIMIT ? OFFSET ?`
      )
      .all(...where.params, pageSize, Math.max(0, (page - 1) * pageSize)) as unknown as AuditRow[]
    return { entries: rows.map(mapAudit), total, page, pageSize }
  }

  stats(filter: AuditFilter): AuditStats {
    const where = buildAuditWhere(filter)
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS ok,
           COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS failed,
           COALESCE(SUM(CASE WHEN approval = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
           COALESCE(SUM(CASE WHEN approval = 'denied' THEN 1 ELSE 0 END), 0) AS denied,
           COALESCE(SUM(CASE WHEN approval = 'not_required' THEN 1 ELSE 0 END), 0) AS not_required,
           MIN(ts) AS first_ts,
           MAX(ts) AS last_ts
         FROM audit_logs ${where.clause}`
      )
      .get(...where.params) as
      | {
          total?: number
          ok?: number
          failed?: number
          approved?: number
          denied?: number
          not_required?: number
          first_ts?: number | null
          last_ts?: number | null
        }
      | undefined

    // 工具下拉不应用 tool 条件，否则选中后只剩一个选项
    const toolWhere = buildAuditWhere({ ...filter, tool: undefined })
    const toolRows = this.db
      .prepare(
        `SELECT DISTINCT tool FROM audit_logs ${toolWhere.clause} ORDER BY tool COLLATE NOCASE ASC`
      )
      .all(...toolWhere.params) as unknown as Array<{ tool: string }>

    return {
      total: Number(row?.total ?? 0),
      ok: Number(row?.ok ?? 0),
      failed: Number(row?.failed ?? 0),
      approved: Number(row?.approved ?? 0),
      denied: Number(row?.denied ?? 0),
      notRequired: Number(row?.not_required ?? 0),
      firstTs: row?.first_ts === null || row?.first_ts === undefined ? null : Number(row.first_ts),
      lastTs: row?.last_ts === null || row?.last_ts === undefined ? null : Number(row.last_ts),
      tools: toolRows.map((item) => item.tool)
    }
  }

  /** 导出用：按筛选条件返回全部条目（带上限） */
  all(filter: AuditFilter, limit: number): AuditEntry[] {
    const where = buildAuditWhere(filter)
    const rows = this.db
      .prepare(`SELECT * FROM audit_logs ${where.clause} ORDER BY ts DESC, rowid DESC LIMIT ?`)
      .all(...where.params, limit) as unknown as AuditRow[]
    return rows.map(mapAudit)
  }
}

export interface FileHistoryRecord {
  id: string
  workspaceRoot: string
  relativePath: string
  source: TimelineSource
  size: number
  contentHash: string
  storagePath: string
  createdAt: number
}

interface FileHistoryRow {
  id: string
  workspace_root: string
  relative_path: string
  source: TimelineSource
  size: number
  content_hash: string
  storage_path: string
  created_at: number
}

function mapFileHistory(row: FileHistoryRow): FileHistoryRecord {
  return {
    id: row.id,
    workspaceRoot: row.workspace_root,
    relativePath: row.relative_path,
    source: row.source,
    size: Number(row.size),
    contentHash: row.content_hash,
    storagePath: row.storage_path,
    createdAt: Number(row.created_at)
  }
}

export class FileHistoryRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(record: FileHistoryRecord): void {
    this.db
      .prepare(
        `INSERT INTO file_history
         (id, workspace_root, relative_path, source, size, content_hash, storage_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workspaceRoot,
        record.relativePath,
        record.source,
        record.size,
        record.contentHash,
        record.storagePath,
        record.createdAt
      )
  }

  list(workspaceRoot: string, relativePath: string, limit = 50): FileHistoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM file_history
         WHERE workspace_root = ? AND relative_path = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(workspaceRoot, relativePath, limit) as unknown as FileHistoryRow[]
    return rows.map(mapFileHistory)
  }

  get(id: string): FileHistoryRecord | null {
    const row = this.db.prepare('SELECT * FROM file_history WHERE id = ?').get(id) as
      FileHistoryRow | undefined
    return row ? mapFileHistory(row) : null
  }

  latest(workspaceRoot: string, relativePath: string): FileHistoryRecord | null {
    return this.list(workspaceRoot, relativePath, 1)[0] ?? null
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM file_history WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }

  prune(
    workspaceRoot: string,
    relativePath: string,
    keep: number,
    cutoff: number
  ): FileHistoryRecord[] {
    const rows = this.list(workspaceRoot, relativePath, Number.MAX_SAFE_INTEGER)
    const removed = rows.filter((row, index) => index >= keep || row.createdAt < cutoff)
    for (const row of removed) {
      this.delete(row.id)
    }
    return removed
  }
}

/* -------------------------------------------------------------------------- */
/* P4：扩展管理器                                                              */
/* -------------------------------------------------------------------------- */

export interface ExtensionRecord {
  id: string
  source: string
  /** 归一化后的清单摘要（NormalizedManifest） */
  manifestJson: string
  enabled: boolean
  compatible: boolean
  installedAt: number
}

interface ExtensionRow {
  id: string
  source: string
  manifest_json: string
  enabled: number
  compatible: number
  installed_at: number
}

function mapExtension(row: ExtensionRow): ExtensionRecord {
  return {
    id: row.id,
    source: row.source,
    manifestJson: row.manifest_json,
    enabled: Number(row.enabled) === 1,
    compatible: Number(row.compatible) === 1,
    installedAt: Number(row.installed_at)
  }
}

export class ExtensionRepository {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  list(): ExtensionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM extensions ORDER BY installed_at DESC')
      .all() as unknown as ExtensionRow[]
    return rows.map(mapExtension)
  }

  get(id: string): ExtensionRecord | null {
    const row = this.db.prepare('SELECT * FROM extensions WHERE id = ?').get(id) as
      ExtensionRow | undefined
    return row ? mapExtension(row) : null
  }

  upsert(record: ExtensionRecord): void {
    this.db
      .prepare(
        `INSERT INTO extensions (id, source, manifest_json, enabled, compatible, installed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source = excluded.source,
           manifest_json = excluded.manifest_json,
           enabled = excluded.enabled,
           compatible = excluded.compatible,
           installed_at = excluded.installed_at`
      )
      .run(
        record.id,
        record.source,
        record.manifestJson,
        record.enabled ? 1 : 0,
        record.compatible ? 1 : 0,
        record.installedAt
      )
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const result = this.db
      .prepare('UPDATE extensions SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, id)
    return Number(result.changes) > 0
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM extensions WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }
}
