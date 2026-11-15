import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { MIGRATION_V1, migrate, SCHEMA_VERSION } from '../../src/main/db/database'
import {
  AuditRepository,
  MessageRepository,
  ProjectRepository,
  SessionRepository,
  SettingsRepository,
  ToolCallRepository
} from '../../src/main/db/repositories'

function createDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

describe('database migrations', () => {
  it('applies the schema idempotently', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    migrate(db)
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(Number(row.user_version)).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('backfills projects from v1 sessions', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(MIGRATION_V1)
    db.exec('PRAGMA user_version = 1')
    db.prepare(
      'INSERT INTO sessions (id, title, workspace_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('legacy-session', '旧会话', 'E:/legacy-project', 1, 1)

    migrate(db)

    const projects = new ProjectRepository(db)
    const sessions = new SessionRepository(db)
    const list = projects.list()
    expect(list).toHaveLength(1)
    expect(list[0].root).toBe('E:/legacy-project')
    expect(list[0].name).toBe('legacy-project')
    expect(sessions.get('legacy-session')?.projectId).toBe(list[0].id)
    db.close()
  })
})

describe('SessionRepository', () => {
  it('creates, renames and cascades message deletion', () => {
    const db = createDb()
    const sessions = new SessionRepository(db)
    const messages = new MessageRepository(db)

    const created = sessions.create({
      title: '会话 1',
      workspaceRoot: 'E:/workspace',
      projectId: null
    })
    expect(sessions.list()).toHaveLength(1)
    expect(sessions.get(created.id)?.title).toBe('会话 1')

    const renamed = sessions.rename(created.id, '新标题')
    expect(renamed?.title).toBe('新标题')

    messages.insert({
      id: 'message-1',
      sessionId: created.id,
      role: 'user',
      content: '你好',
      createdAt: Date.now()
    })
    expect(messages.listBySession(created.id)).toHaveLength(1)

    expect(sessions.delete(created.id)).toBe(true)
    expect(sessions.get(created.id)).toBeNull()
    expect(messages.listBySession(created.id)).toHaveLength(0)
    db.close()
  })

  it('rejects duplicate or dangling message sessions', () => {
    const db = createDb()
    const messages = new MessageRepository(db)
    expect(() =>
      messages.insert({
        id: 'orphan',
        sessionId: 'missing',
        role: 'user',
        content: 'x',
        createdAt: Date.now()
      })
    ).toThrow()
    db.close()
  })
})

describe('ProjectRepository and session filters', () => {
  it('ensures projects, counts active sessions and renames', () => {
    const db = createDb()
    const projects = new ProjectRepository(db)
    const sessions = new SessionRepository(db)

    const project = projects.ensure('E:/project-a')
    expect(projects.ensure('E:/project-a').id).toBe(project.id)

    const first = sessions.create({
      title: '会话 1',
      workspaceRoot: project.root,
      projectId: project.id
    })
    sessions.create({ title: '会话 2', workspaceRoot: project.root, projectId: project.id })
    expect(projects.get(project.id)?.sessionCount).toBe(2)

    sessions.setArchived(first.id, true)
    expect(projects.get(project.id)?.sessionCount).toBe(1)
    expect(projects.rename(project.id, '新项目名')?.name).toBe('新项目名')
    db.close()
  })

  it('supports pin, archive and moving sessions between projects', () => {
    const db = createDb()
    const projects = new ProjectRepository(db)
    const sessions = new SessionRepository(db)

    const projectA = projects.ensure('E:/project-a')
    const projectB = projects.ensure('E:/project-b')
    const sessionA = sessions.create({
      title: 'A',
      workspaceRoot: projectA.root,
      projectId: projectA.id
    })
    const sessionB = sessions.create({
      title: 'B',
      workspaceRoot: projectB.root,
      projectId: projectB.id
    })

    sessions.setPinned(sessionB.id, true)
    expect(sessions.list()[0].id).toBe(sessionB.id)

    sessions.setArchived(sessionA.id, true)
    expect(sessions.list().some((session) => session.id === sessionA.id)).toBe(false)
    expect(sessions.list({ includeArchived: true })).toHaveLength(2)

    sessions.move(sessionB.id, projectA.id, projectA.root)
    const moved = sessions.get(sessionB.id)
    expect(moved?.projectId).toBe(projectA.id)
    expect(moved?.workspaceRoot).toBe(projectA.root)
    expect(sessions.list({ projectId: projectB.id })).toHaveLength(0)
    db.close()
  })
})

describe('SettingsRepository and audit/tool repositories', () => {
  it('stores JSON settings and supports deletion', () => {
    const db = createDb()
    const settings = new SettingsRepository(db)
    settings.set('provider', 'openai')
    settings.set('baseUrl', 'https://api.example.com/v1')
    expect(settings.get('provider')).toBe('openai')
    expect(settings.get('baseUrl')).toBe('https://api.example.com/v1')
    settings.delete('provider')
    expect(settings.get('provider')).toBeUndefined()
    db.close()
  })

  it('persists tool calls and audit entries with filters', () => {
    const db = createDb()
    const toolCalls = new ToolCallRepository(db)
    const audit = new AuditRepository(db)

    toolCalls.insert({
      id: 'tc-1',
      sessionId: 's1',
      runId: 'r1',
      callId: 'call-1',
      tool: 'read_file',
      argsSummary: 'README.md',
      resultSummary: 'ok',
      approval: 'not_required',
      status: 'success',
      createdAt: Date.now()
    })
    expect(toolCalls.countBySession('s1')).toBe(1)

    audit.insert({
      id: 'a1',
      ts: 1000,
      sessionId: 's1',
      runId: 'r1',
      tool: 'write_file',
      argsSummary: 'a.txt',
      resultSummary: '写入 a.txt',
      approval: 'approved',
      ok: true
    })
    audit.insert({
      id: 'a2',
      ts: 2000,
      sessionId: 's2',
      runId: 'r2',
      tool: 'run_command',
      argsSummary: 'node -v',
      resultSummary: 'exit 0',
      approval: 'denied',
      ok: false
    })

    const listed = audit.list({ limit: 10 })
    expect(listed.map((entry) => entry.id)).toEqual(['a2', 'a1'])
    expect(audit.list({ sessionId: 's1' })).toHaveLength(1)
    expect(audit.list({ limit: 1 })[0].ok).toBe(false)
    db.close()
  })
})
