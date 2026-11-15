import { copyFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 3

export const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workspace_root TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args_summary TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  approval TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args_summary TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  approval TEXT NOT NULL,
  ok INTEGER NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs(ts);
`

const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE sessions ADD COLUMN project_id TEXT;
ALTER TABLE sessions ADD COLUMN pinned_at INTEGER;
ALTER TABLE sessions ADD COLUMN archived_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(pinned_at);
CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived_at);
`

const MIGRATION_V3 = `
CREATE TABLE IF NOT EXISTS file_history (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  source TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_history_path ON file_history(workspace_root, relative_path, created_at);
`

function getUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

function backfillProjects(db: DatabaseSync): void {
  const roots = db
    .prepare(
      "SELECT DISTINCT workspace_root AS root FROM sessions WHERE workspace_root IS NOT NULL AND workspace_root <> ''"
    )
    .all() as unknown as Array<{ root: string }>
  const find = db.prepare('SELECT id FROM projects WHERE root = ?')
  const insert = db.prepare(
    'INSERT INTO projects (id, root, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
  const update = db.prepare(
    'UPDATE sessions SET project_id = ? WHERE workspace_root = ? AND project_id IS NULL'
  )
  const now = Date.now()

  for (const { root } of roots) {
    const existing = find.get(root) as { id?: string } | undefined
    const projectId = existing?.id ?? randomUUID()
    if (!existing) {
      insert.run(projectId, root, basename(root) || root, now, now)
    }
    update.run(projectId, root)
  }
}

export function migrate(db: DatabaseSync): void {
  const version = getUserVersion(db)

  if (version < 1) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V1)
      db.exec('PRAGMA user_version = 1')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 2) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V2)
      backfillProjects(db)
      db.exec('PRAGMA user_version = 2')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 3) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V3)
      db.exec('PRAGMA user_version = 3')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

function backupBeforeUpgrade(db: DatabaseSync, filePath: string, version: number): void {
  if (filePath === ':memory:' || version <= 0 || version >= SCHEMA_VERSION) return
  const backupPath = `${filePath}.bak-v${version}`
  if (existsSync(backupPath)) return
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    if (existsSync(filePath)) {
      copyFileSync(filePath, backupPath)
    }
  } catch {
    // 备份失败不阻止迁移；失败详情会由迁移错误另行暴露
  }
}

export function openDatabase(filePath: string): DatabaseSync {
  const db = new DatabaseSync(filePath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  backupBeforeUpgrade(db, filePath, getUserVersion(db))
  migrate(db)
  return db
}
