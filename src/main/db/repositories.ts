import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentStep } from '../../shared/agent'
import type { ConventionSource, ProjectConvention } from '../../shared/conventions'
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

interface ConventionRow {
  project_id: string
  content: string
  source: ConventionSource
  updated_at: number
  updated_by: string | null
}

interface MessageRow {
  id: string
  session_id: string
  role: StoredMessageRole
  content: string
  created_at: number
  reasoning_content: string | null
  steps_json: string | null
  run_started_at: number | null
  run_ended_at: number | null
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

function parseSteps(json: string | null | undefined): AgentStep[] | undefined {
  if (!json) return undefined
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return undefined
    const steps = parsed.filter(
      (item): item is AgentStep =>
        typeof item === 'object' && item !== null && typeof (item as AgentStep).callId === 'string'
    )
    return steps.length ? steps : undefined
  } catch {
    // 历史脏数据不应让整条消息无法显示
    return undefined
  }
}

function mapMessage(row: MessageRow): StoredMessage {
  const steps = parseSteps(row.steps_json)
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: Number(row.created_at),
    ...(row.reasoning_content ? { reasoningContent: row.reasoning_content } : {}),
    ...(steps ? { steps } : {}),
    ...(row.run_started_at ? { runStartedAt: Number(row.run_started_at) } : {}),
    ...(row.run_ended_at ? { runEndedAt: Number(row.run_ended_at) } : {})
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

  /**
   * 仅清理应用内数据：项目记录及其全部会话（含已归档）。
   * 不接触项目目录或任何磁盘文件。messages/agent_context/agent_plan 由外键级联，
   * tool_calls 无外键需手动删除；agent_usage/audit_logs 作为历史账单与审计记录保留。
   */
  delete(id: string): { removed: boolean; removedSessions: number } {
    const rows = this.db.prepare('SELECT id FROM sessions WHERE project_id = ?').all(id) as {
      id: string
    }[]
    this.db.exec('BEGIN')
    try {
      for (const row of rows) {
        this.db.prepare('DELETE FROM tool_calls WHERE session_id = ?').run(row.id)
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id)
      }
      const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      this.db.exec('COMMIT')
      return { removed: Number(result.changes) > 0, removedSessions: rows.length }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

function mapConvention(row: ConventionRow): ProjectConvention {
  return {
    projectId: row.project_id,
    content: row.content,
    source: row.source === 'ai' ? 'ai' : 'manual',
    updatedAt: Number(row.updated_at),
    updatedBy: row.updated_by ?? 'user'
  }
}

/** 项目约定按 projectId 一行存储；projects 删除时由外键级联清理。 */
export class ProjectConventionRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(projectId: string): ProjectConvention | null {
    const row = this.db
      .prepare('SELECT * FROM project_conventions WHERE project_id = ?')
      .get(projectId) as ConventionRow | undefined
    return row ? mapConvention(row) : null
  }

  save(
    projectId: string,
    content: string,
    source: ConventionSource = 'manual',
    updatedBy = 'user'
  ): ProjectConvention {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO project_conventions (project_id, content, source, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           content = excluded.content,
           source = excluded.source,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`
      )
      .run(projectId, content, source, now, updatedBy)
    return this.get(projectId) as ProjectConvention
  }

  remove(projectId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM project_conventions WHERE project_id = ?')
      .run(projectId)
    return Number(result.changes) > 0
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
        'INSERT INTO messages (id, session_id, role, content, reasoning_content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        message.id,
        message.sessionId,
        message.role,
        message.content,
        message.reasoningContent ?? null,
        message.createdAt
      )
  }

  countBySession(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?')
      .get(sessionId) as { count?: number } | undefined
    return Number(row?.count ?? 0)
  }

  /**
   * 回写渲染层维护的时间线快照。正文/思考链仍由 message:done 落库，
   * 冲突时只补充步骤与 run 时间，避免覆盖刚写入的更完整正文。
   */
  upsertRunMessages(sessionId: string, messages: StoredMessage[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO messages
       (id, session_id, role, content, reasoning_content, created_at,
        steps_json, run_started_at, run_ended_at)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         steps_json = excluded.steps_json,
         run_started_at = excluded.run_started_at,
         run_ended_at = excluded.run_ended_at`
    )
    this.db.exec('BEGIN')
    try {
      for (const message of messages) {
        stmt.run(
          message.id,
          sessionId,
          message.content,
          message.reasoningContent ?? null,
          message.createdAt,
          message.steps?.length ? JSON.stringify(message.steps) : null,
          message.runStartedAt ?? null,
          message.runEndedAt ?? null
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return messages.length
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

export interface RemoteTargetRecord {
  id: string
  kind: 'wsl' | 'ssh'
  name: string
  distro: string | null
  host: string | null
  port: number | null
  username: string | null
  authType: 'agent' | 'key' | 'password' | null
  keyPath: string | null
  rootPath: string
  hostFingerprint: string | null
  /** safeStorage 加密后的口令；renderer 永远拿不到明文 */
  secretEncrypted: string | null
  createdAt: number
  updatedAt: number
}

interface RemoteTargetRow {
  id: string
  kind: string
  name: string
  distro: string | null
  host: string | null
  port: number | null
  username: string | null
  auth_type: string | null
  key_path: string | null
  root_path: string
  host_fingerprint: string | null
  secret_encrypted: string | null
  created_at: number
  updated_at: number
}

function mapRemoteTarget(row: RemoteTargetRow): RemoteTargetRecord {
  return {
    id: row.id,
    kind: row.kind === 'ssh' ? 'ssh' : 'wsl',
    name: row.name,
    distro: row.distro,
    host: row.host,
    port: row.port === null ? null : Number(row.port),
    username: row.username,
    authType:
      row.auth_type === 'key' || row.auth_type === 'password' || row.auth_type === 'agent'
        ? row.auth_type
        : null,
    keyPath: row.key_path,
    rootPath: row.root_path,
    hostFingerprint: row.host_fingerprint,
    secretEncrypted: row.secret_encrypted,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

export class RemoteTargetRepository {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  list(): RemoteTargetRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM remote_targets ORDER BY updated_at DESC')
      .all() as unknown as RemoteTargetRow[]
    return rows.map(mapRemoteTarget)
  }

  get(id: string): RemoteTargetRecord | null {
    const row = this.db.prepare('SELECT * FROM remote_targets WHERE id = ?').get(id) as
      RemoteTargetRow | undefined
    return row ? mapRemoteTarget(row) : null
  }

  upsert(record: RemoteTargetRecord): void {
    this.db
      .prepare(
        `INSERT INTO remote_targets (
           id, kind, name, distro, host, port, username, auth_type, key_path,
           root_path, host_fingerprint, secret_encrypted, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           name = excluded.name,
           distro = excluded.distro,
           host = excluded.host,
           port = excluded.port,
           username = excluded.username,
           auth_type = excluded.auth_type,
           key_path = excluded.key_path,
           root_path = excluded.root_path,
           host_fingerprint = excluded.host_fingerprint,
           secret_encrypted = excluded.secret_encrypted,
           updated_at = excluded.updated_at`
      )
      .run(
        record.id,
        record.kind,
        record.name,
        record.distro,
        record.host,
        record.port,
        record.username,
        record.authType,
        record.keyPath,
        record.rootPath,
        record.hostFingerprint,
        record.secretEncrypted,
        record.createdAt,
        record.updatedAt
      )
  }

  setHostFingerprint(id: string, fingerprint: string): void {
    this.db
      .prepare('UPDATE remote_targets SET host_fingerprint = ?, updated_at = ? WHERE id = ?')
      .run(fingerprint, Date.now(), id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM remote_targets WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }
}

export type AgentContextRole = 'user' | 'assistant' | 'tool' | 'summary'

export interface AgentContextEntry {
  id: string
  sessionId: string
  seq: number
  role: AgentContextRole
  content: string
  toolCallsJson: string | null
  toolCallId: string | null
  /** 推理模型的隐藏思考内容：原样回传，不参与 UI 渲染 */
  reasoningContent?: string | null
  tokens: number
  createdAt: number
}

interface AgentContextRow {
  id: string
  session_id: string
  seq: number
  role: AgentContextRole
  content: string
  tool_calls_json: string | null
  tool_call_id: string | null
  reasoning_content: string | null
  tokens: number
  created_at: number
}

function mapContextRow(row: AgentContextRow): AgentContextEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    role: row.role,
    content: row.content,
    toolCallsJson: row.tool_calls_json,
    toolCallId: row.tool_call_id,
    reasoningContent: row.reasoning_content,
    tokens: row.tokens,
    createdAt: row.created_at
  }
}

/**
 * 模型侧上下文仓储：每个会话一条有序流水（seq 单调递增）。
 * 压缩 = 把 seq ≤ N 的条目替换成一条 summary 条目（seq = N），
 * 因此剩余条目顺序不变，重放时无需额外排序字段。
 */
export class AgentContextRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(sessionId: string): AgentContextEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_context WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as unknown as AgentContextRow[]
    return rows.map(mapContextRow)
  }

  nextSeq(sessionId: string): number {
    const row = this.db
      .prepare('SELECT MAX(seq) AS seq FROM agent_context WHERE session_id = ?')
      .get(sessionId) as { seq?: number | null } | undefined
    return Number(row?.seq ?? 0) + 1
  }

  append(entry: Omit<AgentContextEntry, 'seq'> & { seq?: number }): AgentContextEntry {
    const seq = entry.seq ?? this.nextSeq(entry.sessionId)
    this.db
      .prepare(
        `INSERT INTO agent_context
         (id, session_id, seq, role, content, tool_calls_json, tool_call_id, reasoning_content,
          tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.sessionId,
        seq,
        entry.role,
        entry.content,
        entry.toolCallsJson,
        entry.toolCallId,
        entry.reasoningContent ?? null,
        entry.tokens,
        entry.createdAt
      )
    return { ...entry, seq }
  }

  /** 用一条摘要替换 seq ≤ throughSeq 的全部条目 */
  compactThrough(
    sessionId: string,
    throughSeq: number,
    summary: Omit<AgentContextEntry, 'seq' | 'sessionId' | 'role'>
  ): AgentContextEntry {
    this.db
      .prepare('DELETE FROM agent_context WHERE session_id = ? AND seq <= ?')
      .run(sessionId, throughSeq)
    return this.append({
      ...summary,
      sessionId,
      seq: throughSeq,
      role: 'summary'
    })
  }

  /** 硬裁剪：直接删除 seq ≤ throughSeq 的条目（压缩后仍超窗口时的最后手段） */
  deleteThrough(sessionId: string, throughSeq: number): number {
    const result = this.db
      .prepare('DELETE FROM agent_context WHERE session_id = ? AND seq <= ?')
      .run(sessionId, throughSeq)
    return Number(result.changes)
  }

  countBySession(sessionId: string): { entries: number; summaries: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS entries,
                SUM(CASE WHEN role = 'summary' THEN 1 ELSE 0 END) AS summaries
         FROM agent_context WHERE session_id = ?`
      )
      .get(sessionId) as { entries?: number; summaries?: number | null } | undefined
    return {
      entries: Number(row?.entries ?? 0),
      summaries: Number(row?.summaries ?? 0)
    }
  }

  latestSummaryAt(sessionId: string): number | null {
    const row = this.db
      .prepare(
        "SELECT MAX(created_at) AS ts FROM agent_context WHERE session_id = ? AND role = 'summary'"
      )
      .get(sessionId) as { ts?: number | null } | undefined
    return row?.ts ?? null
  }

  clear(sessionId: string): void {
    this.db.prepare('DELETE FROM agent_context WHERE session_id = ?').run(sessionId)
  }
}

export interface AgentPlanRow {
  session_id: string
  plan_json: string
  updated_at: number
}

/**
 * Agent 计划存储：每会话一份当前计划，update_plan 全量覆写。
 * 计划跨重启持久化（会话删除时随 CASCADE 清理）。
 */
export class AgentPlanRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(
    sessionId: string
  ): { plan: Array<{ step: string; status: string }>; updatedAt: number } | null {
    const row = this.db
      .prepare('SELECT * FROM agent_plan WHERE session_id = ?')
      .get(sessionId) as unknown as AgentPlanRow | undefined
    if (!row) return null
    try {
      const plan = JSON.parse(row.plan_json) as Array<{ step: string; status: string }>
      if (!Array.isArray(plan)) return null
      return { plan, updatedAt: row.updated_at }
    } catch {
      return null
    }
  }

  set(sessionId: string, plan: Array<{ step: string; status: string }>): void {
    this.db
      .prepare(
        `INSERT INTO agent_plan (session_id, plan_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET plan_json = excluded.plan_json, updated_at = excluded.updated_at`
      )
      .run(sessionId, JSON.stringify(plan), Date.now())
  }

  clear(sessionId: string): void {
    this.db.prepare('DELETE FROM agent_plan WHERE session_id = ?').run(sessionId)
  }
}

export interface UsageRecord {
  id: string
  sessionId: string
  providerId: string
  model: string
  inputTokens: number
  outputTokens: number
  createdAt: number
}

export interface UsageAggregate {
  providerId: string
  model: string
  inputTokens: number
  outputTokens: number
  calls: number
  /** 最后一次使用时间 */
  lastUsedAt: number
}

/**
 * Token 用量存储：每次模型调用记一条，账单面板按 provider/model 汇总。
 * Provider 不回传 usage 的场景下不会有记录（不影响其他功能）。
 */
export class UsageRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(record: UsageRecord): void {
    this.db
      .prepare(
        `INSERT INTO agent_usage (id, session_id, provider_id, model, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.sessionId,
        record.providerId,
        record.model,
        Math.max(0, Math.round(record.inputTokens)),
        Math.max(0, Math.round(record.outputTokens)),
        record.createdAt
      )
  }

  /** 按 provider+model 汇总；可限定时间窗口 */
  aggregate(since?: number): UsageAggregate[] {
    const rows = (since
      ? this.db
          .prepare(
            `SELECT provider_id, model,
                      SUM(input_tokens) AS input_tokens,
                      SUM(output_tokens) AS output_tokens,
                      COUNT(*) AS calls,
                      MAX(created_at) AS last_used_at
               FROM agent_usage WHERE created_at >= ?
               GROUP BY provider_id, model ORDER BY calls DESC`
          )
          .all(since)
      : this.db
          .prepare(
            `SELECT provider_id, model,
                      SUM(input_tokens) AS input_tokens,
                      SUM(output_tokens) AS output_tokens,
                      COUNT(*) AS calls,
                      MAX(created_at) AS last_used_at
               FROM agent_usage GROUP BY provider_id, model ORDER BY calls DESC`
          )
          .all()) as unknown as Array<{
      provider_id: string
      model: string
      input_tokens: number | null
      output_tokens: number | null
      calls: number
      last_used_at: number | null
    }>
    return rows.map((row) => ({
      providerId: row.provider_id,
      model: row.model,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      calls: row.calls ?? 0,
      lastUsedAt: row.last_used_at ?? 0
    }))
  }

  /** 总用量（含拆分） */
  totals(since?: number): { inputTokens: number; outputTokens: number; calls: number } {
    const rows = (since
      ? this.db
          .prepare(
            `SELECT SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, COUNT(*) AS calls
               FROM agent_usage WHERE created_at >= ?`
          )
          .all(since)
      : this.db
          .prepare(
            `SELECT SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, COUNT(*) AS calls
               FROM agent_usage`
          )
          .all()) as unknown as Array<{
      input_tokens: number | null
      output_tokens: number | null
      calls: number | null
    }>
    const row = rows[0]
    return {
      inputTokens: row?.input_tokens ?? 0,
      outputTokens: row?.output_tokens ?? 0,
      calls: row?.calls ?? 0
    }
  }

  /** 清理时间窗口之前的记录 */
  prune(before: number): number {
    const result = this.db.prepare('DELETE FROM agent_usage WHERE created_at < ?').run(before)
    return Number(result.changes ?? 0)
  }
}
