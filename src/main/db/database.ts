import { copyFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 14

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

const MIGRATION_V4 = `
ALTER TABLE audit_logs ADD COLUMN call_id TEXT;
ALTER TABLE audit_logs ADD COLUMN duration_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_audit_logs_session ON audit_logs(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tool ON audit_logs(tool, ts);
`

const MIGRATION_V5 = `
CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  compatible INTEGER NOT NULL,
  installed_at INTEGER NOT NULL
);
`

const MIGRATION_V6 = `
CREATE TABLE IF NOT EXISTS remote_targets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  distro TEXT,
  host TEXT,
  port INTEGER,
  username TEXT,
  auth_type TEXT,
  key_path TEXT,
  root_path TEXT NOT NULL,
  host_fingerprint TEXT,
  secret_encrypted TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_remote_targets_kind ON remote_targets(kind, updated_at);
`

/**
 * Agent 上下文存储：模型实际看到的对话流（含工具调用与结果、压缩摘要）。
 * 与 messages 表分开：messages 只服务 UI 渲染，压缩不会改动用户看到的聊天记录。
 */
const MIGRATION_V7 = `
CREATE TABLE IF NOT EXISTS agent_context (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  tool_call_id TEXT,
  tokens INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_context_session ON agent_context(session_id, seq);
`

/** Agent 计划存储：每个会话一份当前计划（update_plan 工具全量覆写）。 */
const MIGRATION_V8 = `
CREATE TABLE IF NOT EXISTS agent_plan (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  plan_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`

/** Token 用量：账单面板按 provider/model 汇总，配合用户填写的单价估算费用。 */
const MIGRATION_V9 = `
CREATE TABLE IF NOT EXISTS agent_usage (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_usage_created ON agent_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_usage_provider ON agent_usage(provider_id, model, created_at);
`

/**
 * 推理模型的隐藏思考内容：带工具调用的助手消息必须原样回传 reasoning_content，
 * 否则 DeepSeek 等 Provider 在下一轮返回 HTTP 400。
 */
const MIGRATION_V10 = `
ALTER TABLE agent_context ADD COLUMN reasoning_content TEXT;
`

/** 会话消息里的思考内容：刷新/切换会话后思考块仍能展开查看。 */
const MIGRATION_V11 = `
ALTER TABLE messages ADD COLUMN reasoning_content TEXT;
`

/**
 * 消息时间线：执行步骤与 run 起止时间随消息一起持久化，
 * 切会话/重启后仍能复原聊天里的执行步骤流。
 */
const MIGRATION_V12 = `
ALTER TABLE messages ADD COLUMN steps_json TEXT;
ALTER TABLE messages ADD COLUMN run_started_at INTEGER;
ALTER TABLE messages ADD COLUMN run_ended_at INTEGER;
`

/**
 * 项目约定：一个项目一份 Markdown，按 projectId 隔离。
 * 删除项目时由外键级联清理，避免留下孤儿约定。
 */
const MIGRATION_V13 = `
CREATE TABLE IF NOT EXISTS project_conventions (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
`

/**
 * Anthropic extended thinking 的 thinking block 签名：启用思考且历史里有工具调用时，
 * 必须把思考内容与签名原样回传，否则下一轮请求被拒绝（HTTP 400）。
 */
const MIGRATION_V14 = `
ALTER TABLE agent_context ADD COLUMN reasoning_signature TEXT;
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

  if (version < 4) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V4)
      db.exec('PRAGMA user_version = 4')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 5) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V5)
      db.exec('PRAGMA user_version = 5')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 6) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V6)
      db.exec('PRAGMA user_version = 6')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 7) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V7)
      db.exec('PRAGMA user_version = 7')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 8) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V8)
      db.exec('PRAGMA user_version = 8')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 9) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V9)
      db.exec('PRAGMA user_version = 9')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 10) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V10)
      db.exec('PRAGMA user_version = 10')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 11) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V11)
      db.exec('PRAGMA user_version = 11')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 12) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V12)
      db.exec('PRAGMA user_version = 12')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 13) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V13)
      db.exec('PRAGMA user_version = 13')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (version < 14) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATION_V14)
      db.exec('PRAGMA user_version = 14')
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
