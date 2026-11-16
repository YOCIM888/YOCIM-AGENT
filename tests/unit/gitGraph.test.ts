import { describe, expect, it } from 'vitest'
import {
  FIELD_SEP,
  RECORD_SEP,
  parseCommitLog,
  parseNameStatus,
  parseNumstat,
  parseRefNames
} from '../../src/main/git/gitGraph'
import {
  computeGraphLayout,
  formatRelativeTime,
  GRAPH_MERGE_CY,
  GRAPH_NODE_CY,
  segmentPieces,
  splitConventionalPrefix
} from '../../src/renderer/src/lib/gitGraph'
import type { GitCommitNode } from '../../src/shared/git'

function record(fields: string[]): string {
  return fields.join(FIELD_SEP) + RECORD_SEP
}

function node(sha: string, parents: string[] = []): GitCommitNode {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents,
    author: 'Someone',
    authorEmail: 'a@b.c',
    date: 1_700_000_000_000,
    subject: `commit ${sha}`,
    branches: [],
    remotes: [],
    tags: [],
    current: false
  }
}

describe('parseRefNames', () => {
  it('splits branches, remotes and tags', () => {
    const refs = parseRefNames('HEAD -> master, origin/main, tag: v1.0')
    expect(refs.branches).toEqual(['master'])
    expect(refs.remotes).toEqual(['origin/main'])
    expect(refs.tags).toEqual(['v1.0'])
    expect(refs.head).toBe(true)
  })

  it('handles an empty ref list', () => {
    expect(parseRefNames('')).toEqual({
      branches: [],
      remotes: [],
      tags: [],
      head: false
    })
  })
})

describe('parseCommitLog', () => {
  it('parses commits with fields and refs', () => {
    const output =
      record([
        'abc123',
        'abc1234',
        'parent1 parent2',
        '张三',
        'z@e.com',
        '1700000000',
        'feat: 新增功能',
        'HEAD -> master'
      ]) + record(['def456', 'def4567', '', '李四', 'l@e.com', '1700000100', 'docs: 说明', ''])

    const commits = parseCommitLog(output, 'abc123')
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({
      sha: 'abc123',
      shortSha: 'abc1234',
      parents: ['parent1', 'parent2'],
      author: '张三',
      authorEmail: 'z@e.com',
      date: 1_700_000_000_000,
      subject: 'feat: 新增功能',
      branches: ['master'],
      current: true
    })
    expect(commits[1].current).toBe(false)
    expect(commits[1].parents).toEqual([])
  })
})

describe('parseNumstat', () => {
  it('reads added and deleted lines per file', () => {
    const output = '12\t3\tsrc/a.ts\0' + '0\t1\tsrc/b.ts\0'
    const files = parseNumstat(output)
    expect(files).toEqual([
      { path: 'src/a.ts', added: 12, deleted: 3, status: 'M', binary: false },
      { path: 'src/b.ts', added: 0, deleted: 1, status: 'M', binary: false }
    ])
  })

  it('marks binary files and keeps renames', () => {
    const binary = parseNumstat('-\t-\timage.png\0')
    expect(binary[0].binary).toBe(true)
    expect(binary[0].added).toBe(0)

    const renamed = parseNumstat('2\t1\t\0old.ts\0new.ts\0')
    expect(renamed[0]).toMatchObject({
      path: 'new.ts',
      originalPath: 'old.ts',
      status: 'R',
      added: 2,
      deleted: 1
    })
  })
})

describe('parseNameStatus', () => {
  it('maps statuses onto paths', () => {
    const output = 'M\0src/a.ts\0A\0src/b.ts\0R100\0old.ts\0new.ts\0'
    const statuses = parseNameStatus(output)
    expect(statuses.get('src/a.ts')).toBe('M')
    expect(statuses.get('src/b.ts')).toBe('A')
    expect(statuses.get('new.ts')).toBe('R')
  })
})

describe('computeGraphLayout', () => {
  it('keeps a linear history on one lane', () => {
    // git log 是「新 → 旧」：a 是最新，c 是根提交
    const commits = [node('a', ['b']), node('b', ['c']), node('c')]
    const layout = computeGraphLayout(commits)
    expect(layout.laneOf).toEqual([0, 0, 0])
    expect(layout.laneCount).toBe(1)
    expect(layout.segments).toHaveLength(1)
    expect(layout.segments[0]).toMatchObject({ lane: 0, from: 0, to: 2 })
    expect(layout.merges).toHaveLength(0)
  })

  it('opens a new lane for the second parent of a merge', () => {
    // merge(m) 的两个父提交分别是 p1 与 p2
    const commits = [node('m', ['p1', 'p2']), node('p1'), node('p2')]
    const layout = computeGraphLayout(commits)
    expect(layout.laneCount).toBe(2)
    expect(layout.laneOf[0]).toBe(0)
    expect(layout.merges).toEqual([{ fromLane: 0, toLane: 1, row: 0 }])
  })

  it('draws a vertical piece only on the rows a segment covers', () => {
    const segment = { lane: 0, from: 1, to: 3, fromMerge: false }
    expect(segmentPieces(segment, 0, 26)).toBeNull()
    const head = segmentPieces(segment, 1, 26)
    expect(head).toEqual({ top: GRAPH_NODE_CY, bottom: 26 })
    const middle = segmentPieces(segment, 2, 26)
    expect(middle).toEqual({ top: 0, bottom: 26 })
    const tail = segmentPieces(segment, 3, 26)
    expect(tail).toEqual({ top: 0, bottom: GRAPH_NODE_CY })
  })

  it('starts merge lanes below the branch point', () => {
    const segment = { lane: 1, from: 0, to: 2, fromMerge: true }
    expect(segmentPieces(segment, 0, 26)).toEqual({ top: GRAPH_MERGE_CY, bottom: 26 })
  })
})

describe('splitConventionalPrefix', () => {
  it('splits conventional commit prefixes', () => {
    expect(splitConventionalPrefix('feat(scope): 新增功能')).toEqual({
      prefix: 'feat',
      rest: '新增功能'
    })
    expect(splitConventionalPrefix('普通提交')).toEqual({ prefix: '', rest: '普通提交' })
  })
})

describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000
  it('formats recent and older timestamps', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 小时前')
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 天前')
    expect(formatRelativeTime(0, now)).toBe('')
  })
})
