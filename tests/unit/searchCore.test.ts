import { describe, expect, it } from 'vitest'
import type { SearchQuery } from '../../src/shared/ipc'
import {
  applyEol,
  applyReplacements,
  buildRipgrepArgs,
  compileSearchRegex,
  findMatches,
  hashContent,
  isGitIgnored,
  lineAfterReplacement,
  matchesFileFilters,
  normalizeEol,
  parseGitignore,
  replacementFor
} from '../../src/main/workspace/searchCore'

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

describe('content hashing and EOL handling', () => {
  it('hashes normalized LF content so CRLF and LF agree', () => {
    expect(normalizeEol('a\r\nb')).toEqual({ content: 'a\nb', eol: 'crlf' })
    expect(normalizeEol('a\nb')).toEqual({ content: 'a\nb', eol: 'lf' })
    expect(hashContent(normalizeEol('a\r\nb').content)).toBe(hashContent('a\nb'))
    expect(applyEol('a\nb', 'crlf')).toBe('a\r\nb')
  })
})

describe('findMatches', () => {
  it('matches literal text with 1-based line/column ranges', () => {
    const matches = findMatches('foo foo\nno match\nfoo', query())
    expect(matches).toHaveLength(3)
    expect(matches[0]).toMatchObject({ line: 1, column: 1, endColumn: 4, matchText: 'foo' })
    expect(matches[1]).toMatchObject({ line: 1, column: 5, endColumn: 8 })
    expect(matches[2]).toMatchObject({ line: 3, column: 1, endColumn: 4 })
  })

  it('respects case sensitivity and whole-word options', () => {
    expect(findMatches('Foo foo FOOBAR', query({ caseSensitive: true }))).toHaveLength(1)
    expect(findMatches('foo foobar foo-bar', query({ wholeWord: true }))).toHaveLength(2)
  })

  it('supports regex, capture groups and rejects invalid patterns', () => {
    const matches = findMatches(
      'foo = foo2',
      query({ useRegex: true, query: '(f)(oo)', replaceText: '$2-$1' })
    )
    expect(matches.map((match) => match.replaceText)).toEqual(['oo-f', 'oo-f'])
    expect(() => compileSearchRegex(query({ useRegex: true, query: '(' }))).toThrow(
      /正则表达式不合法/
    )
  })

  it('does not loop forever on zero-length regex matches', () => {
    const matches = findMatches('ab', query({ useRegex: true, query: 'x*' }), 5)
    expect(matches).toHaveLength(0)
  })

  it('honours the per-file match limit', () => {
    expect(findMatches('foo '.repeat(20), query(), 3)).toHaveLength(3)
  })

  it('preserves the matched case when requested', () => {
    expect(replacementFor('FOO', query({ preserveCase: true }))).toBe('BAR')
    expect(replacementFor('Foo', query({ preserveCase: true }))).toBe('Bar')
    expect(replacementFor('foo', query({ preserveCase: true }))).toBe('bar')
    expect(replacementFor('Foo', query())).toBe('bar')
  })
})

describe('applyReplacements', () => {
  it('replaces multiple matches per line from right to left', () => {
    const content = 'foo foo\nnothing\nfoo'
    const matches = findMatches(content, query({ replaceText: 'x' }))
    expect(applyReplacements(content, matches)).toBe('x x\nnothing\nx')
  })

  it('replaces only the selected match for single-match scope', () => {
    const content = 'foo foo'
    const matches = findMatches(content, query({ replaceText: 'x' }))
    expect(applyReplacements(content, [matches[0]])).toBe('x foo')
  })

  it('builds a preview for a single line', () => {
    const content = 'foo foo'
    const matches = findMatches(content, query({ replaceText: 'x' }))
    expect(lineAfterReplacement(content, 1, matches)).toBe('x x')
    expect(lineAfterReplacement(content, 1, [matches[1]])).toBe('foo x')
  })
})

describe('buildRipgrepArgs', () => {
  it('uses fixed strings, JSON output and case-insensitive search by default', () => {
    const args = buildRipgrepArgs(query())
    expect(args).toContain('--json')
    expect(args).toContain('--fixed-strings')
    expect(args).toContain('-i')
    expect(args.slice(-2)).toEqual(['-e', 'foo'])
  })

  it('maps regex, case sensitivity, whole word, include/exclude and includeIgnored', () => {
    const args = buildRipgrepArgs(
      query({
        useRegex: true,
        caseSensitive: true,
        wholeWord: true,
        includeIgnored: true,
        include: '*.ts, src/**',
        exclude: '*.min.js'
      })
    )
    expect(args).not.toContain('--fixed-strings')
    expect(args).not.toContain('-i')
    expect(args).toContain('-w')
    expect(args).toContain('--no-ignore')
    expect(args).toContain('*.ts')
    expect(args).toContain('src/**')
    expect(args).toContain('!*.min.js')
  })

  it('keeps --hidden but always excludes VCS metadata directories', () => {
    const args = buildRipgrepArgs(query())
    expect(args).toContain('--hidden')
    // 非 git 目录也要走 .gitignore，否则内置搜索与 ripgrep 结果不一致
    expect(args).toContain('--no-require-git')
    for (const name of ['.git', '.hg', '.svn', 'node_modules', 'dist', 'release']) {
      expect(args).toContain(`!${name}`)
      expect(args).toContain(`!${name}/**`)
    }
  })
})

describe('file filters and gitignore', () => {
  it('applies include/exclude globs with basename semantics', () => {
    expect(matchesFileFilters('src/app.ts', query({ include: '*.ts' }))).toBe(true)
    expect(matchesFileFilters('src/app.ts', query({ include: 'src/**' }))).toBe(true)
    expect(matchesFileFilters('src/app.md', query({ include: '*.ts' }))).toBe(false)
    expect(matchesFileFilters('src/app.ts', query({ exclude: 'src/app.*' }))).toBe(false)
    expect(matchesFileFilters('src/app.ts', query({ include: '*.ts,!src/skip*' }))).toBe(true)
    expect(matchesFileFilters('src/skip.ts', query({ include: '*.ts,!src/skip*' }))).toBe(false)
  })

  it('honours gitignore patterns, negations and directory rules', () => {
    const rules = parseGitignore('*.log\nbuild/\n/dist\n!important.log\n')
    expect(isGitIgnored('debug.log', rules, false)).toBe(true)
    expect(isGitIgnored('src/debug.log', rules, false)).toBe(true)
    expect(isGitIgnored('important.log', rules, false)).toBe(false)
    expect(isGitIgnored('build', rules, true)).toBe(true)
    expect(isGitIgnored('build/a.ts', rules, false)).toBe(false)
    expect(isGitIgnored('dist', rules, true)).toBe(true)
    expect(isGitIgnored('src/dist', rules, true)).toBe(false)
  })

  it('scopes nested .gitignore rules to their base directory', () => {
    const rules = parseGitignore('secret.txt\n', 'src')
    expect(isGitIgnored('src/secret.txt', rules, false)).toBe(true)
    expect(isGitIgnored('secret.txt', rules, false)).toBe(false)
  })
})
