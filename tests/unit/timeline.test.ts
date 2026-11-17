import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIGRATION_V1, migrate, SCHEMA_VERSION } from '../../src/main/db/database'
import { FileHistoryRepository } from '../../src/main/db/repositories'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'
import { TIMELINE_LIMITS, TimelineService } from '../../src/main/workspace/timelineService'

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  return db
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return Number(row.user_version)
}

function hasTable(db: DatabaseSync, name: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)
  return Boolean(row)
}

describe('schema migration', () => {
  it('creates file_history on a fresh database and reaches the current version', () => {
    const db = memoryDb()
    migrate(db)
    expect(userVersion(db)).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(13)
    expect(hasTable(db, 'file_history')).toBe(true)
    expect(hasTable(db, 'extensions')).toBe(true)
    expect(hasTable(db, 'agent_context')).toBe(true)
    expect(hasTable(db, 'agent_plan')).toBe(true)
    expect(hasTable(db, 'remote_targets')).toBe(true)
    expect(hasTable(db, 'agent_usage')).toBe(true)
    db.close()
  })

  it('upgrades a v1 database through the later migrations', () => {
    const db = memoryDb()
    db.exec(MIGRATION_V1)
    db.exec('PRAGMA user_version = 1')
    migrate(db)
    expect(userVersion(db)).toBe(SCHEMA_VERSION)
    expect(hasTable(db, 'projects')).toBe(true)
    expect(hasTable(db, 'file_history')).toBe(true)
    expect(hasTable(db, 'extensions')).toBe(true)
    expect(hasTable(db, 'remote_targets')).toBe(true)
    db.close()
  })

  it('is idempotent', () => {
    const db = memoryDb()
    migrate(db)
    migrate(db)
    expect(userVersion(db)).toBe(SCHEMA_VERSION)
    db.close()
  })
})

describe('FileHistoryRepository', () => {
  it('inserts, lists newest first, dedups via latest and prunes', () => {
    const db = memoryDb()
    migrate(db)
    const repo = new FileHistoryRepository(db)
    const base = { workspaceRoot: 'E:/w', relativePath: 'a.ts', source: 'agent' as const }
    for (let i = 0; i < 5; i += 1) {
      repo.insert({
        ...base,
        id: `id-${i}`,
        size: i,
        contentHash: `hash-${i}`,
        storagePath: `E:/store/${i}.txt`,
        createdAt: 1000 + i
      })
    }
    expect(repo.list('E:/w', 'a.ts').map((r) => r.id)).toEqual([
      'id-4',
      'id-3',
      'id-2',
      'id-1',
      'id-0'
    ])
    expect(repo.latest('E:/w', 'a.ts')?.contentHash).toBe('hash-4')
    expect(repo.get('id-2')?.size).toBe(2)

    const removed = repo.prune('E:/w', 'a.ts', 2, 1003)
    expect(removed.map((r) => r.id).sort()).toEqual(['id-0', 'id-1', 'id-2'])
    expect(repo.list('E:/w', 'a.ts').map((r) => r.id)).toEqual(['id-4', 'id-3'])
    expect(repo.delete('id-4')).toBe(true)
    expect(repo.delete('id-4')).toBe(false)
    db.close()
  })
})

let tempRoot: string
let baseDir: string
let workspaceRoot: string
let guard: WorkspacePathGuard
let db: DatabaseSync
let clock: number

function makeService(): TimelineService {
  return new TimelineService({
    history: new FileHistoryRepository(db),
    baseDir,
    now: () => clock
  })
}

async function countSnapshots(dir: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await countSnapshots(full)
    else if (entry.name.endsWith('.txt')) total += 1
  }
  return total
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-timeline-'))
  baseDir = path.join(tempRoot, 'timeline')
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  guard = await WorkspacePathGuard.create(workspaceRoot)
  db = memoryDb()
  migrate(db)
  clock = 1_000_000
})

afterEach(async () => {
  db.close()
  await rm(tempRoot, { recursive: true, force: true })
})

describe('TimelineService', () => {
  it('snapshots content, dedups identical writes and skips binary/oversized', async () => {
    const service = makeService()
    const first = await service.snapshot({
      workspaceRoot,
      relativePath: 'a.ts',
      source: 'agent',
      content: 'v1'
    })
    expect(first).not.toBeNull()
    expect(first!.size).toBe(2)

    const dup = await service.snapshot({
      workspaceRoot,
      relativePath: 'a.ts',
      source: 'agent',
      content: 'v1'
    })
    expect(dup).toBeNull()

    expect(
      await service.snapshot({
        workspaceRoot,
        relativePath: 'b.ts',
        source: 'agent',
        content: 'a\0b'
      })
    ).toBeNull()
    expect(
      await service.snapshot({
        workspaceRoot,
        relativePath: 'c.ts',
        source: 'agent',
        content: 'x'.repeat(TIMELINE_LIMITS.maxSnapshotBytes + 1)
      })
    ).toBeNull()

    expect(service.list(workspaceRoot, 'a.ts')).toHaveLength(1)
  })

  it('reads snapshot content and lists newest first', async () => {
    const service = makeService()
    clock += 1
    const a = await service.snapshot({
      workspaceRoot,
      relativePath: 'a.ts',
      source: 'agent',
      content: 'one'
    })
    clock += 1
    const b = await service.snapshot({
      workspaceRoot,
      relativePath: 'a.ts',
      source: 'user',
      content: 'two'
    })
    const list = service.list(workspaceRoot, 'a.ts')
    expect(list.map((e) => e.id)).toEqual([b!.id, a!.id])
    const read = await service.read(a!.id)
    expect(read.content).toBe('one')
    expect(read.entry.source).toBe('agent')
  })

  it('restores a snapshot into the workspace and records a user entry', async () => {
    const service = makeService()
    const snap = await service.snapshot({
      workspaceRoot,
      relativePath: 'a.ts',
      source: 'agent',
      content: 'original'
    })
    clock += 1
    await service.snapshot({
      workspaceRoot,
      relativePath: 'a.ts',
      source: 'agent',
      content: 'changed'
    })
    await writeFile(path.join(workspaceRoot, 'a.ts'), 'changed')
    clock += 1
    const result = await service.restore(snap!.id, guard)
    expect(result.content).toBe('original')
    expect(await readFile(path.join(workspaceRoot, 'a.ts'), 'utf8')).toBe('original')
    const list = service.list(workspaceRoot, 'a.ts')
    expect(list[0].source).toBe('user')
  })

  it('rejects restoring a snapshot from another workspace', async () => {
    const service = makeService()
    const snap = await service.snapshot({
      workspaceRoot: 'E:/other',
      relativePath: 'a.ts',
      source: 'agent',
      content: 'x'
    })
    await expect(service.restore(snap!.id, guard)).rejects.toMatchObject({
      code: 'E_INVALID_INPUT'
    })
  })

  it('enforces entry retention and removes old snapshot files', async () => {
    const service = makeService()
    for (let i = 0; i < TIMELINE_LIMITS.maxEntries + 5; i += 1) {
      clock += 1
      await service.snapshot({
        workspaceRoot,
        relativePath: 'a.ts',
        source: 'agent',
        content: `v${i}`
      })
    }
    expect(service.list(workspaceRoot, 'a.ts')).toHaveLength(TIMELINE_LIMITS.maxEntries)
    expect(await countSnapshots(baseDir)).toBe(TIMELINE_LIMITS.maxEntries)
  })

  it('prunes entries older than the retention window', async () => {
    const service = makeService()
    await service.snapshot({ workspaceRoot, relativePath: 'a.ts', source: 'agent', content: 'old' })
    clock += TIMELINE_LIMITS.maxAgeMs + 1
    await service.snapshot({ workspaceRoot, relativePath: 'a.ts', source: 'agent', content: 'new' })
    const list = service.list(workspaceRoot, 'a.ts')
    expect(list).toHaveLength(1)
    expect(list[0].contentHash).toBeDefined()
    expect(await countSnapshots(baseDir)).toBe(1)
  })
})
