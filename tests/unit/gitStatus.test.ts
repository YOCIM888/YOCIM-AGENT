import { describe, expect, it } from 'vitest'
import { parseGitStatus, unquoteGitPath } from '../../src/main/git/gitStatus'

describe('parseGitStatus', () => {
  it('parses branch headers, ahead/behind and a clean worktree', () => {
    const parsed = parseGitStatus(
      [
        '# branch.oid 1a2b3c',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -3'
      ].join('\n')
    )
    expect(parsed.branch).toBe('main')
    expect(parsed.detached).toBe(false)
    expect(parsed.initial).toBe(false)
    expect(parsed.upstream).toBe('origin/main')
    expect(parsed.ahead).toBe(2)
    expect(parsed.behind).toBe(3)
    expect(parsed.staged).toHaveLength(0)
    expect(parsed.unstaged).toHaveLength(0)
    expect(parsed.untracked).toHaveLength(0)
  })

  it('marks the first commit and detached head', () => {
    const initial = parseGitStatus('# branch.oid (initial)\n# branch.head main')
    expect(initial.initial).toBe(true)
    expect(initial.branch).toBe('main')

    const detached = parseGitStatus('# branch.oid abc123\n# branch.head (detached)')
    expect(detached.detached).toBe(true)
    expect(detached.branch).toBe('')
  })

  it('splits ordinary entries into staged and unstaged groups', () => {
    const parsed = parseGitStatus(
      [
        '# branch.head main',
        '1 M. N... 100644 100644 100644 aaa bbb src/staged.ts',
        '1 .M N... 100644 100644 100644 aaa bbb src/with space.ts',
        '1 MM N... 100644 100644 100644 aaa bbb both.txt',
        '1 .D N... 100644 100644 100644 aaa bbb gone.txt'
      ].join('\n')
    )

    expect(parsed.staged.map((change) => change.path)).toEqual(['src/staged.ts', 'both.txt'])
    expect(parsed.unstaged.map((change) => change.path)).toEqual([
      'src/with space.ts',
      'both.txt',
      'gone.txt'
    ])
    expect(parsed.staged[0].indexStatus).toBe('M')
    expect(parsed.unstaged[2].worktreeStatus).toBe('D')
  })

  it('keeps rename source paths and unmerged conflicts', () => {
    const parsed = parseGitStatus(
      [
        '# branch.head main',
        '2 R. N... 100644 100644 100644 aaa bbb R100 new/name.ts\told/name.ts',
        'u UU N... 100644 100644 100644 100644 a1 a2 a3 conflict.ts'
      ].join('\n')
    )

    expect(parsed.staged[0]).toMatchObject({
      path: 'new/name.ts',
      originalPath: 'old/name.ts',
      indexStatus: 'R'
    })
    expect(parsed.conflicted).toHaveLength(1)
    expect(parsed.conflicted[0]).toMatchObject({ path: 'conflict.ts', conflict: true })
  })

  it('parses untracked entries and quoted unicode paths', () => {
    const parsed = parseGitStatus(
      [
        '# branch.head main',
        '? notes/new file.md',
        '? "docs/\\344\\270\\255\\346\\226\\207.md"',
        '! ignored.txt'
      ].join('\n')
    )

    expect(parsed.untracked.map((change) => change.path)).toEqual([
      'notes/new file.md',
      'docs/中文.md'
    ])
    expect(parsed.untracked[0].indexStatus).toBe('?')
  })

  it('ignores unknown record types gracefully', () => {
    const parsed = parseGitStatus(['# branch.head main', '# unknown header', ''].join('\n'))
    expect(parsed.staged).toHaveLength(0)
    expect(parsed.branch).toBe('main')
  })
})

describe('unquoteGitPath', () => {
  it('returns plain paths unchanged', () => {
    expect(unquoteGitPath('src/app.ts')).toBe('src/app.ts')
  })

  it('decodes escaped quotes and control characters', () => {
    expect(unquoteGitPath('"a\\"b.ts"')).toBe('a"b.ts')
    expect(unquoteGitPath('"tab\\there"')).toBe('tab\there')
  })
})
