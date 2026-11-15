import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/database'
import { FileHistoryRepository } from '../../src/main/db/repositories'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'
import { hashContent } from '../../src/main/workspace/searchCore'
import { TimelineService } from '../../src/main/workspace/timelineService'
import { readWorkspaceFile, writeWorkspaceFile } from '../../src/main/workspace/workspaceFs'

let tempRoot: string
let workspaceRoot: string
let db: DatabaseSync
let timeline: TimelineService
let guard: WorkspacePathGuard

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-write-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  guard = await WorkspacePathGuard.create(workspaceRoot)
  db = new DatabaseSync(':memory:')
  migrate(db)
  timeline = new TimelineService({
    history: new FileHistoryRepository(db),
    baseDir: path.join(tempRoot, 'timeline'),
    now: () => Date.now()
  })
})

afterEach(async () => {
  db.close()
  await rm(tempRoot, { recursive: true, force: true })
})

describe('readWorkspaceFile P2 metadata', () => {
  it('returns a content hash, EOL and text kind', async () => {
    await writeFile(path.join(workspaceRoot, 'a.txt'), 'hello\r\nworld')
    const result = await readWorkspaceFile(guard, { relativePath: 'a.txt' })
    expect(result).toMatchObject({
      content: 'hello\nworld',
      eol: 'crlf',
      kind: 'text',
      truncated: false
    })
    expect(result.contentHash).toBe(hashContent('hello\nworld'))
  })

  it('returns a data URL for images and rejects binaries', async () => {
    await writeFile(path.join(workspaceRoot, 'logo.png'), Buffer.from([137, 80, 78, 71]))
    const image = await readWorkspaceFile(guard, { relativePath: 'logo.png' })
    expect(image.kind).toBe('image')
    expect(image.imageDataUrl).toMatch(/^data:image\/png;base64,/)
    await writeFile(path.join(workspaceRoot, 'data.bin'), Buffer.from([1, 0, 2]))
    await expect(readWorkspaceFile(guard, { relativePath: 'data.bin' })).rejects.toMatchObject({
      code: 'E_UNSUPPORTED'
    })
  })

  it('records an external snapshot when the expected hash no longer matches', async () => {
    await writeFile(path.join(workspaceRoot, 'a.txt'), 'external change')
    await readWorkspaceFile(
      guard,
      { relativePath: 'a.txt', expectedHash: hashContent('old') },
      timeline
    )
    expect(timeline.list(guard.root, 'a.txt').map((entry) => entry.source)).toEqual(['external'])
  })
})

describe('writeWorkspaceFile', () => {
  it('saves editor content, preserves CRLF and snapshots both versions', async () => {
    const target = path.join(workspaceRoot, 'a.txt')
    await writeFile(target, 'one\r\ntwo')
    const read = await readWorkspaceFile(guard, { relativePath: 'a.txt' })
    const result = await writeWorkspaceFile(
      guard,
      {
        relativePath: 'a.txt',
        content: 'one\ntwo\nthree',
        expectedHash: read.contentHash,
        force: false,
        createIfMissing: false,
        eol: read.eol
      },
      timeline
    )
    expect(result.status).toBe('saved')
    if (result.status === 'saved') {
      expect(result.version.contentHash).toBe(hashContent('one\ntwo\nthree'))
      expect(result.version.eol).toBe('crlf')
    }
    expect(await readFile(target, 'utf8')).toBe('one\r\ntwo\r\nthree')
    const sources = timeline
      .list(guard.root, 'a.txt')
      .map((entry) => entry.source)
      .sort()
    expect(sources).toEqual(['user', 'user'])
  })

  it('returns the disk version on external modification instead of overwriting', async () => {
    const target = path.join(workspaceRoot, 'a.txt')
    await writeFile(target, 'original')
    await writeFile(target, 'external')
    const result = await writeWorkspaceFile(
      guard,
      {
        relativePath: 'a.txt',
        content: 'editor buffer',
        expectedHash: hashContent('original'),
        force: false,
        createIfMissing: false
      },
      timeline
    )
    expect(result.status).toBe('conflict')
    if (result.status === 'conflict') {
      expect(result.disk.content).toBe('external')
      expect(result.disk.contentHash).toBe(hashContent('external'))
    }
    expect(await readFile(target, 'utf8')).toBe('external')
    expect(timeline.list(guard.root, 'a.txt').some((entry) => entry.source === 'external')).toBe(
      true
    )
  })

  it('force overwrites a conflicting disk version but keeps the external snapshot', async () => {
    const target = path.join(workspaceRoot, 'a.txt')
    await writeFile(target, 'changed externally')
    const result = await writeWorkspaceFile(
      guard,
      {
        relativePath: 'a.txt',
        content: 'force saved',
        expectedHash: hashContent('stale'),
        force: true,
        createIfMissing: false
      },
      timeline
    )
    expect(result.status).toBe('saved')
    expect(await readFile(target, 'utf8')).toBe('force saved')
    expect(timeline.list(guard.root, 'a.txt').some((entry) => entry.source === 'external')).toBe(
      true
    )
  })

  it('saves as a new file and rejects existing targets', async () => {
    const source = path.join(workspaceRoot, 'a.txt')
    await writeFile(source, 'original')
    const result = await writeWorkspaceFile(
      guard,
      {
        relativePath: 'a.txt',
        content: 'copy content',
        force: false,
        createIfMissing: true,
        targetPath: 'nested/copy.txt'
      },
      timeline
    )
    expect(result.status).toBe('saved')
    expect(await readFile(path.join(workspaceRoot, 'nested', 'copy.txt'), 'utf8')).toBe(
      'copy content'
    )
    expect(await readFile(source, 'utf8')).toBe('original')
    await expect(
      writeWorkspaceFile(
        guard,
        {
          relativePath: 'a.txt',
          content: 'again',
          force: false,
          createIfMissing: true,
          targetPath: 'nested/copy.txt'
        },
        timeline
      )
    ).rejects.toMatchObject({ code: 'E_EXISTS' })
  })
})
