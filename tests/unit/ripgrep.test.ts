import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SearchQuery } from '../../src/shared/ipc'
import {
  findRipgrepPath,
  parseRipgrepJson,
  ripgrepCandidates,
  ripgrepSubmatchesToMatches
} from '../../src/main/workspace/ripgrep'

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

describe('parseRipgrepJson', () => {
  // 用平台无关的绝对根：path.join('E:', ...) 在 POSIX 上不是绝对路径，
  // 会让本文件只在 Windows 通过。
  const root = path.resolve(path.sep, 'workspace')

  it('parses begin/match/end records and normalizes relative paths', () => {
    const begin = JSON.stringify({ type: 'begin', data: { path: { text: './src/a.ts' } } })
    const match = JSON.stringify({
      type: 'match',
      data: { path: { text: 'src/a.ts' }, lines: { text: 'foo\n' }, line_number: 3 }
    })
    const end = JSON.stringify({ type: 'end', data: { path: { text: 'src/a.ts' } } })
    expect(parseRipgrepJson(begin, root)).toEqual({ kind: 'begin', relativePath: 'src/a.ts' })
    expect(parseRipgrepJson(match, root)).toEqual({ kind: 'match', relativePath: 'src/a.ts' })
    expect(parseRipgrepJson(end, root)).toEqual({ kind: 'end', relativePath: 'src/a.ts' })
  })

  it('converts absolute and Windows-style paths into workspace-relative paths', () => {
    const absolute = path.join(root, 'src', 'a.ts')
    expect(
      parseRipgrepJson(JSON.stringify({ type: 'match', data: { path: { text: absolute } } }), root)
    ).toEqual({
      kind: 'match',
      relativePath: 'src/a.ts'
    })
    expect(
      parseRipgrepJson(
        JSON.stringify({ type: 'match', data: { path: { text: 'src\\a.ts' } } }),
        root
      )
    ).toEqual({ kind: 'match', relativePath: 'src/a.ts' })
  })

  it('ignores invalid JSON, summaries and paths without text', () => {
    expect(parseRipgrepJson('not json', root)).toEqual({ kind: 'other' })
    expect(parseRipgrepJson(JSON.stringify({ type: 'summary', data: {} }), root)).toEqual({
      kind: 'other'
    })
    expect(parseRipgrepJson(JSON.stringify({ type: 'match', data: { path: {} } }), root)).toEqual({
      kind: 'other'
    })
  })
})

describe('ripgrepSubmatchesToMatches', () => {
  it('turns byte offsets into 1-based columns and computes the replacement', () => {
    const event = {
      type: 'match',
      data: {
        path: { text: 'a.ts' },
        lines: { text: 'hello foo\n' },
        line_number: 2,
        submatches: [{ match: { text: 'foo' }, start: 6, end: 9 }]
      }
    }
    expect(ripgrepSubmatchesToMatches(event, query())).toEqual([
      {
        line: 2,
        column: 7,
        endColumn: 10,
        lineText: 'hello foo',
        matchText: 'foo',
        replaceText: 'bar'
      }
    ])
  })
})

describe('findRipgrepPath', () => {
  let dir: string
  const original = process.env['YOCIM_RIPGREP_PATH']

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'yocim-rg-'))
  })

  afterEach(async () => {
    if (original === undefined) delete process.env['YOCIM_RIPGREP_PATH']
    else process.env['YOCIM_RIPGREP_PATH'] = original
    await rm(dir, { recursive: true, force: true })
  })

  it('prefers the configured binary path when it exists', async () => {
    const executable = path.join(dir, 'rg.exe')
    await writeFile(executable, '')
    process.env['YOCIM_RIPGREP_PATH'] = executable
    expect(ripgrepCandidates()[0]).toBe(executable)
    expect(await findRipgrepPath()).toBe(executable)
  })
})
