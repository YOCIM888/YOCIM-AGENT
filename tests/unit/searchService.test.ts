import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/database'
import { FileHistoryRepository } from '../../src/main/db/repositories'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'
import { hashContent, normalizeEol } from '../../src/main/workspace/searchCore'
import { SearchService } from '../../src/main/workspace/searchService'
import { TimelineService } from '../../src/main/workspace/timelineService'
import type { SearchEvent, SearchQuery } from '../../src/shared/ipc'

function query(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    query: 'foo',
    replaceText: 'bar',
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    preserveCase: false,
    include: '',
    exclude: '',
    includeIgnored: false,
    onlyOpenEditors: false,
    openFiles: [],
    maxResults: 5000,
    ...overrides
  }
}

let tempRoot: string
let workspaceRoot: string
let db: DatabaseSync
let timeline: TimelineService
let guard: WorkspacePathGuard
let service: SearchService

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-search-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'secret'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(path.join(workspaceRoot, 'src', 'a.ts'), 'foo foo\n')
  await writeFile(path.join(workspaceRoot, 'README.md'), 'foo in readme\n')
  await writeFile(path.join(workspaceRoot, 'secret', 'foo.txt'), 'foo secret\n')
  await writeFile(path.join(workspaceRoot, 'node_modules', 'pkg', 'x.js'), 'foo dep\n')
  await writeFile(path.join(workspaceRoot, '.gitignore'), '*.md\nsecret/\n')
  await writeFile(path.join(workspaceRoot, 'binary.dat'), Buffer.from([102, 0, 111, 111]))
  guard = await WorkspacePathGuard.create(workspaceRoot)
  db = new DatabaseSync(':memory:')
  migrate(db)
  timeline = new TimelineService({
    history: new FileHistoryRepository(db),
    baseDir: path.join(tempRoot, 'timeline'),
    now: () => Date.now()
  })
  service = new SearchService({ getGuard: () => guard, timeline, findRg: async () => null })
})

afterEach(async () => {
  db.close()
  await rm(tempRoot, { recursive: true, force: true })
})

async function collect(
  q: SearchQuery,
  onFile?: (searchId: string) => void
): Promise<SearchEvent[]> {
  const events: SearchEvent[] = []
  return new Promise<SearchEvent[]>((resolve, reject) => {
    let searchId = ''
    const timer = setTimeout(() => reject(new Error('search timed out')), 8000)
    void service
      .start(q, (event) => {
        events.push(event)
        if (event.kind === 'file' && onFile) onFile(searchId)
        if (event.kind === 'done') {
          clearTimeout(timer)
          resolve(events)
        }
      })
      .then((result) => {
        searchId = result.searchId
      })
      .catch((error: unknown) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function pathsOf(events: SearchEvent[]): string[] {
  return events.flatMap((event) =>
    event.kind === 'file' && event.file ? [event.file.relativePath] : []
  )
}

describe('SearchService builtin engine', () => {
  it('streams per-file results, respects gitignore/noise dirs and skips binaries', async () => {
    const events = await collect(query())
    expect(pathsOf(events)).toEqual(['src/a.ts'])
    const file = events.find((event) => event.kind === 'file')?.file
    expect(file?.matches).toHaveLength(2)
    expect(file?.matches[0]).toMatchObject({ line: 1, column: 1, endColumn: 4 })
    expect(file?.contentHash).toBe(hashContent('foo foo\n'))
    const done = events.at(-1)
    expect(done).toMatchObject({
      kind: 'done',
      engine: 'builtin',
      totalMatches: 2,
      totalFiles: 1,
      truncated: false
    })
  })

  it('applies include/exclude globs and can include ignored files', async () => {
    expect(pathsOf(await collect(query({ include: '*.ts' })))).toEqual(['src/a.ts'])
    expect(pathsOf(await collect(query({ exclude: 'src/**' })))).toEqual([])
    const withIgnored = pathsOf(await collect(query({ includeIgnored: true })))
    expect(withIgnored).toContain('README.md')
    expect(withIgnored).toContain('secret/foo.txt')
    expect(withIgnored).toContain('node_modules/pkg/x.js')
  })

  it('searches only open editors when requested', async () => {
    const found = pathsOf(
      await collect(query({ onlyOpenEditors: true, openFiles: ['README.md', 'src/a.ts'] }))
    )
    expect(new Set(found)).toEqual(new Set(['README.md', 'src/a.ts']))
  })

  it('caps results at the configured limit and marks the search truncated', async () => {
    const events = await collect(query({ maxResults: 1 }))
    expect(events.at(-1)).toMatchObject({ truncated: true, totalMatches: 1 })
  })

  it('can be cancelled mid-search', async () => {
    for (let index = 0; index < 24; index += 1) {
      await writeFile(path.join(workspaceRoot, 'src', `f${index}.ts`), 'foo\n')
    }
    let cancelled = false
    const events = await collect(query(), (searchId) => {
      if (!cancelled && searchId) {
        cancelled = true
        expect(service.cancel(searchId).cancelled).toBe(true)
      }
    })
    expect(cancelled).toBe(true)
    expect(events.some((event) => event.kind === 'cancelled')).toBe(true)
    expect(events.at(-1)?.kind).toBe('done')
  })
})

describe('SearchService.replace', () => {
  it('previews, applies and rolls back via timeline snapshots', async () => {
    const events = await collect(query())
    const file = events.find(
      (event) => event.kind === 'file' && event.file?.relativePath === 'src/a.ts'
    )?.file
    expect(file).toBeDefined()
    const target = { relativePath: 'src/a.ts', hash: file!.contentHash }
    const q = query({ replaceText: 'bar' })

    const preview = await service.replace({ query: q, scope: 'all', apply: false, files: [target] })
    expect(preview).toMatchObject({ applied: false, totalReplaced: 2 })
    expect(preview.files[0].previews[0]).toMatchObject({
      line: 1,
      before: 'foo foo',
      after: 'bar bar'
    })
    expect(await readFile(path.join(workspaceRoot, 'src', 'a.ts'), 'utf8')).toBe('foo foo\n')

    const applied = await service.replace({ query: q, scope: 'all', apply: true, files: [target] })
    expect(applied).toMatchObject({ applied: true, totalReplaced: 2, conflicts: [] })
    expect(await readFile(path.join(workspaceRoot, 'src', 'a.ts'), 'utf8')).toBe('bar bar\n')

    const entries = timeline.list(guard.root, 'src/a.ts')
    let originalId = ''
    for (const entry of entries) {
      if ((await timeline.read(entry.id)).content === 'foo foo\n') {
        originalId = entry.id
        break
      }
    }
    expect(originalId).not.toBe('')
    await timeline.restore(originalId, guard)
    expect(await readFile(path.join(workspaceRoot, 'src', 'a.ts'), 'utf8')).toBe('foo foo\n')
  })

  it('skips files modified after the search (hash conflict) and records an external snapshot', async () => {
    const staleHash = hashContent('foo foo\n')
    await writeFile(path.join(workspaceRoot, 'src', 'a.ts'), 'foo changed\n')
    const result = await service.replace({
      query: query({ replaceText: 'bar' }),
      scope: 'all',
      apply: true,
      files: [{ relativePath: 'src/a.ts', hash: staleHash }]
    })
    expect(result.conflicts).toEqual(['src/a.ts'])
    expect(result.files[0].status).toBe('conflict')
    expect(await readFile(path.join(workspaceRoot, 'src', 'a.ts'), 'utf8')).toBe('foo changed\n')
    expect(timeline.list(guard.root, 'src/a.ts').some((entry) => entry.source === 'external')).toBe(
      true
    )
  })

  it('replaces exactly one match for single scope', async () => {
    const content = 'foo foo\n'
    const result = await service.replace({
      query: query({ replaceText: 'bar' }),
      scope: 'single',
      apply: true,
      target: { relativePath: 'src/a.ts', hash: hashContent(content), line: 1, column: 5 },
      files: []
    })
    expect(result.totalReplaced).toBe(1)
    expect(await readFile(path.join(workspaceRoot, 'src', 'a.ts'), 'utf8')).toBe('foo bar\n')
  })

  it('normalizes CRLF content for hashing but writes back with the original EOL', async () => {
    const crlfPath = path.join(workspaceRoot, 'src', 'a.ts')
    await writeFile(crlfPath, 'foo foo\r\n')
    const hash = hashContent(normalizeEol('foo foo\r\n').content)
    await service.replace({
      query: query({ replaceText: 'bar' }),
      scope: 'all',
      apply: true,
      files: [{ relativePath: 'src/a.ts', hash }]
    })
    expect(await readFile(crlfPath, 'utf8')).toBe('bar bar\r\n')
  })
})
