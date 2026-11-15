import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { AuditEntry } from '../../src/shared/audit'
import { AuditStore } from '../../src/main/audit/auditStore'
import { auditToCsv, auditToJson } from '../../src/main/audit/auditExport'
import { MIGRATION_V1, SCHEMA_VERSION, migrate } from '../../src/main/db/database'
import { AuditRepository } from '../../src/main/db/repositories'

function createDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return db
}

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: overrides.id ?? 'a1',
    ts: overrides.ts ?? 1000,
    sessionId: overrides.sessionId ?? 's1',
    runId: overrides.runId ?? 'r1',
    tool: overrides.tool ?? 'read_file',
    argsSummary: overrides.argsSummary ?? 'read hello.txt',
    resultSummary: overrides.resultSummary ?? 'hello',
    approval: overrides.approval ?? 'not_required',
    ok: overrides.ok ?? true,
    ...(overrides.callId ? { callId: overrides.callId } : {}),
    ...(typeof overrides.durationMs === 'number' ? { durationMs: overrides.durationMs } : {})
  }
}

describe('audit schema migration', () => {
  it('adds call_id and duration_ms to existing v1 tables', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(MIGRATION_V1)
    db.exec('PRAGMA user_version = 1')
    db.prepare(
      `INSERT INTO audit_logs (id, session_id, run_id, tool, args_summary, result_summary, approval, ok, ts)
       VALUES ('legacy', 's0', 'r0', 'read_file', 'a', 'b', 'not_required', 1, 10)`
    ).run()

    migrate(db)

    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(Number(version.user_version)).toBe(SCHEMA_VERSION)

    const repo = new AuditRepository(db)
    const legacy = repo.query({}, 1, 10).entries[0]
    expect(legacy.callId).toBeUndefined()
    expect(legacy.durationMs).toBeUndefined()

    repo.insert(entry({ id: 'new', ts: 20, callId: 'call-1', durationMs: 12 }))
    const created = repo.query({}, 1, 10).entries[0]
    expect(created.callId).toBe('call-1')
    expect(created.durationMs).toBe(12)
    db.close()
  })
})

describe('AuditRepository query and stats', () => {
  function seed(repo: AuditRepository): void {
    repo.insert(
      entry({ id: 'a1', ts: 1000, tool: 'read_file', ok: true, approval: 'not_required' })
    )
    repo.insert(
      entry({
        id: 'a2',
        ts: 2000,
        tool: 'write_file',
        ok: true,
        approval: 'approved',
        argsSummary: 'write notes/a.txt',
        resultSummary: '已写入 notes/a.txt',
        sessionId: 's1'
      })
    )
    repo.insert(
      entry({
        id: 'a3',
        ts: 3000,
        tool: 'write_file',
        ok: false,
        approval: 'denied',
        resultSummary: '审批被拒绝',
        sessionId: 's2'
      })
    )
    repo.insert(
      entry({
        id: 'a4',
        ts: 4000,
        tool: 'run_command',
        ok: false,
        approval: 'not_required',
        argsSummary: 'run_command node -v',
        resultSummary: 'exit 0',
        sessionId: 's2'
      })
    )
  }

  it('filters by session, tool, result, approval, keyword and time range', () => {
    const db = createDb()
    const repo = new AuditRepository(db)
    seed(repo)

    expect(repo.query({}, 1, 10).total).toBe(4)
    expect(repo.query({ sessionId: 's2' }, 1, 10).entries.map((item) => item.id)).toEqual([
      'a4',
      'a3'
    ])
    expect(repo.query({ tool: 'write_file' }, 1, 10).total).toBe(2)
    expect(repo.query({ ok: false }, 1, 10).total).toBe(2)
    expect(repo.query({ approval: 'denied' }, 1, 10).entries[0].id).toBe('a3')
    expect(repo.query({ keyword: 'notes' }, 1, 10).entries[0].id).toBe('a2')
    expect(repo.query({ keyword: 'WRITE' }, 1, 10).total).toBe(2)
    expect(repo.query({ from: 2500, to: 3500 }, 1, 10).entries.map((item) => item.id)).toEqual([
      'a3'
    ])
    db.close()
  })

  it('treats LIKE wildcards in the keyword literally', () => {
    const db = createDb()
    const repo = new AuditRepository(db)
    repo.insert(entry({ id: 'pct', ts: 1000, argsSummary: '100% done' }))
    repo.insert(entry({ id: 'plain', ts: 2000, argsSummary: '100 done' }))

    expect(repo.query({ keyword: '100%' }, 1, 10).entries.map((item) => item.id)).toEqual(['pct'])
    db.close()
  })

  it('paginates and reports the total across pages', () => {
    const db = createDb()
    const repo = new AuditRepository(db)
    seed(repo)

    const first = repo.query({}, 1, 2)
    const second = repo.query({}, 2, 2)
    expect(first.total).toBe(4)
    expect(first.entries.map((item) => item.id)).toEqual(['a4', 'a3'])
    expect(second.entries.map((item) => item.id)).toEqual(['a2', 'a1'])
    expect(repo.query({}, 3, 2).entries).toHaveLength(0)
    db.close()
  })

  it('aggregates stats and keeps the tool list independent of the tool filter', () => {
    const db = createDb()
    const repo = new AuditRepository(db)
    seed(repo)

    const all = repo.stats({})
    expect(all).toMatchObject({
      total: 4,
      ok: 2,
      failed: 2,
      approved: 1,
      denied: 1,
      notRequired: 2,
      firstTs: 1000,
      lastTs: 4000
    })
    expect(all.tools).toEqual(['read_file', 'run_command', 'write_file'])

    const filtered = repo.stats({ tool: 'write_file' })
    expect(filtered.total).toBe(2)
    expect(filtered.tools).toContain('read_file')
    db.close()
  })

  it('returns all matching entries for export with a cap', () => {
    const db = createDb()
    const repo = new AuditRepository(db)
    seed(repo)
    expect(repo.all({}, 10)).toHaveLength(4)
    expect(repo.all({}, 2)).toHaveLength(2)
    expect(repo.all({ sessionId: 's2' }, 10)).toHaveLength(2)
    db.close()
  })
})

describe('AuditStore fallback without a repository', () => {
  it('filters, paginates and aggregates in memory', () => {
    const store = new AuditStore({ maxEntries: 3 })
    store.record({
      sessionId: 's1',
      runId: 'r1',
      tool: 'read_file',
      argsSummary: 'a',
      resultSummary: 'ok',
      approval: 'not_required',
      ok: true
    })
    store.record({
      sessionId: 's1',
      runId: 'r1',
      tool: 'write_file',
      argsSummary: 'b',
      resultSummary: 'no',
      approval: 'denied',
      ok: false
    })
    store.record({
      sessionId: 's2',
      runId: 'r2',
      tool: 'write_file',
      argsSummary: 'c',
      resultSummary: 'ok',
      approval: 'approved',
      ok: true
    })

    const page = store.query({ sessionId: 's1' }, 1, 10)
    expect(page.total).toBe(2)
    expect(page.entries[0].tool).toBe('write_file')

    const stats = store.stats({})
    expect(stats.total).toBe(3)
    expect(stats.failed).toBe(1)
    expect(stats.denied).toBe(1)
    expect(stats.tools).toEqual(['read_file', 'write_file'])
    expect(store.all({}, 2)).toHaveLength(2)
  })
})

describe('audit export builders', () => {
  const entries: AuditEntry[] = [
    entry({
      id: 'a1',
      ts: 1_700_000_000_000,
      tool: 'write_file',
      argsSummary: 'write "quoted", with comma',
      resultSummary: '=SUM(1,2)',
      approval: 'approved',
      callId: 'call-1',
      durationMs: 42
    })
  ]

  it('serializes JSON with a readable approval label', () => {
    const parsed = JSON.parse(auditToJson(entries)) as {
      count: number
      entries: Array<Record<string, unknown>>
    }
    expect(parsed.count).toBe(1)
    expect(parsed.entries[0].approvalLabel).toBe('已批准')
    expect(parsed.entries[0].durationMs).toBe(42)
    expect(parsed.entries[0].time).toBe(new Date(1_700_000_000_000).toISOString())
  })

  it('escapes CSV cells, guards formulas and adds a BOM', () => {
    const csv = auditToCsv(entries)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"write_file"')
    expect(csv).toContain('"write ""quoted"", with comma"')
    // 以 = 开头的内容前置单引号，避免被 Excel 当公式执行
    expect(csv).toContain(`"'=SUM(1,2)"`)
    expect(csv.split('\r\n')[0]).toContain('callId')
  })
})
