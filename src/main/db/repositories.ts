import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AuditEntry } from '../../shared/audit'
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
         (id, session_id, run_id, tool, args_summary, result_summary, approval, ok, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        entry.ts
      )
  }

  list(options: { sessionId?: string; limit?: number } = {}): AuditEntry[] {
    const limit = options.limit ?? 50
    const rows = options.sessionId
      ? (this.db
          .prepare('SELECT * FROM audit_logs WHERE session_id = ? ORDER BY ts DESC LIMIT ?')
          .all(options.sessionId, limit) as unknown as AuditRow[])
      : (this.db
          .prepare('SELECT * FROM audit_logs ORDER BY ts DESC LIMIT ?')
          .all(limit) as unknown as AuditRow[])

    return rows.map((row) => ({
      id: row.id,
      ts: Number(row.ts),
      sessionId: row.session_id,
      runId: row.run_id,
      tool: row.tool,
      argsSummary: row.args_summary,
      resultSummary: row.result_summary,
      approval: row.approval,
      ok: row.ok === 1
    }))
  }
}
