import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/shared/errors'
import {
  detectTestRunner,
  parseDiagnostics,
  runGetGitDiff,
  summarizeTestOutput,
  type TestRunnerKind
} from '../../src/main/tools/verifyTools'
import type { ToolFileIo } from '../../src/main/tools/toolFileIo'

function ioWithFiles(files: Record<string, string>): ToolFileIo {
  return {
    read: async (relativePath: string) => {
      const content = files[relativePath]
      if (content === undefined) throw new AppError('E_NOT_FOUND', `${relativePath} 不存在`)
      return {
        relativePath,
        content,
        size: content.length,
        truncated: false,
        contentHash: 'x',
        eol: 'lf' as const
      }
    },
    write: async () => undefined,
    peek: async (relativePath: string) => files[relativePath] ?? null
  }
}

const VITEST_OUTPUT = `
 ✓ src/a.test.ts (3 tests) 10ms
 ❯ src/b.test.ts (2 tests | 1 failed) 15ms
   × handles edge case
FAIL  src/b.test.ts > handles edge case
AssertionError: expected 1 to be 2

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 4 passed (5)
`

const JEST_OUTPUT = `
FAIL src/b.test.ts
  ● handles edge case

    expect(received).toBe(expected)

    Expected: 2
    Received: 1

      12 |   it('handles edge case', () => {
    > 13 |     expect(compute()).toBe(2)
         |                       ^
      14 |   })

Tests: 1 failed, 4 passed, 5 total
`

const PYTEST_OUTPUT = `
================= short test summary info =================
FAILED tests/test_x.py::test_one - assert 1 == 2
FAILED tests/test_y.py::test_two
================= 2 failed, 5 passed in 0.30s =================

___________ test_one ___________

    def test_one():
>       assert compute() == 2
E       assert 1 == 2
`

const GO_OUTPUT = `
--- FAIL: TestCompute (0.00s)
    compute_test.go:12: got 1, want 2
FAIL
ok      example.com/pkg 0.1s
`

describe('summarizeTestOutput', () => {
  it('extracts vitest counts, failed names and details', () => {
    const summary = summarizeTestOutput('vitest', VITEST_OUTPUT)
    expect(summary.total).toBe(5)
    expect(summary.failed).toBe(1)
    expect(summary.passed).toBe(4)
    expect(summary.failedNames.some((name) => name.includes('handles edge case'))).toBe(true)
    expect(summary.excerpt).toContain('AssertionError')
    expect(summary.excerpt.length).toBeLessThan(3000)
  })

  it('parses vitest total from the parenthesized count on the Tests line', () => {
    const output = ' Test Files  1 failed | 3 passed (4)\n      Tests  1 failed | 3 passed (4)\n'
    const summary = summarizeTestOutput('vitest', output)
    expect(summary.total).toBe(4)
    expect(summary.passed).toBe(3)
    expect(summary.failed).toBe(1)
  })

  it('extracts jest counts and failure blocks', () => {
    const summary = summarizeTestOutput('jest', JEST_OUTPUT)
    expect(summary.total).toBe(5)
    expect(summary.failed).toBe(1)
    expect(summary.excerpt).toContain('expect(compute())')
  })

  it('extracts pytest failures', () => {
    const summary = summarizeTestOutput('pytest', PYTEST_OUTPUT)
    expect(summary.failed).toBe(2)
    expect(summary.passed).toBe(5)
    expect(summary.failedNames).toContain('tests/test_x.py::test_one')
    expect(summary.excerpt).toContain('assert 1 == 2')
  })

  it('parses pytest total from the collected form (second capture group)', () => {
    const summary = summarizeTestOutput('pytest', 'collected 7 items\n')
    expect(summary.total).toBe(7)
    expect(Number.isNaN(summary.total)).toBe(false)
  })

  it('extracts go test failures without NaN counts', () => {
    const summary = summarizeTestOutput('go', GO_OUTPUT)
    expect(summary.failed).toBe(1)
    expect(summary.failedNames).toContain('TestCompute')
    expect(summary.excerpt).toContain('compute_test.go:12')
    expect(summary.passed).toBe(1)
    expect(summary.total).toBe(2)
    expect(Number.isNaN(summary.passed)).toBe(false)
  })

  it('counts go verbose PASS lines as passed', () => {
    const output = '--- PASS: TestOne (0.00s)\n--- PASS: TestTwo (0.00s)\nPASS\nok  example.com/pkg\n'
    const summary = summarizeTestOutput('go', output)
    expect(summary.passed).toBe(2)
    expect(summary.failed).toBeNull()
    expect(summary.total).toBeNull()
  })
})

describe('detectTestRunner', () => {
  it('prefers vitest over jest when both are present', async () => {
    const runner = await detectTestRunner(
      ioWithFiles({
        'package.json': JSON.stringify({
          devDependencies: { vitest: '^2', jest: '^29' }
        })
      })
    )
    expect(runner).toBe<TestRunnerKind>('vitest')
  })

  it('falls back to go.mod then pytest markers', async () => {
    expect(await detectTestRunner(ioWithFiles({ 'go.mod': 'module x' }))).toBe('go')
    expect(await detectTestRunner(ioWithFiles({ 'pytest.ini': '[pytest]' }))).toBe('pytest')
    expect(await detectTestRunner(ioWithFiles({}))).toBeNull()
  })
})

describe('parseDiagnostics', () => {
  it('parses tsc file(line,col) format', () => {
    const summary = parseDiagnostics(
      'src/a.ts(12,5): error TS2322: Type "number" is not assignable to type "string".\n' +
        'src/b.ts(3,1): warning TS6133: unused.\n'
    )
    expect(summary.total).toBe(2)
    expect(summary.entries[0]).toBe(
      'src/a.ts:12:5 error TS2322: Type "number" is not assignable to type "string".'
    )
  })

  it('parses eslint unix format', () => {
    const summary = parseDiagnostics('src/a.ts:4:10: Missing semicolon. [Error]\n')
    expect(summary.total).toBe(1)
    expect(summary.entries[0]).toBe('src/a.ts:4:10 Missing semicolon. [Error]')
  })

  it('ignores noise lines', () => {
    const summary = parseDiagnostics('npx: installed 1 package in 2s\n\nFound 0 errors.\n')
    expect(summary.total).toBe(0)
  })
})

describe('runGetGitDiff', () => {
  it('reports an empty diff', async () => {
    const outcome = await runGetGitDiff({ staged: false, relativePath: '' }, async () => ({
      ok: true,
      text: ''
    }))
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('没有未提交的改动')
  })

  it('truncates large diffs', async () => {
    const outcome = await runGetGitDiff({ staged: false, relativePath: '' }, async () => ({
      ok: true,
      text: 'x'.repeat(9000)
    }))
    expect(outcome.content).toContain('[diff 已截断]')
    expect(outcome.content.length).toBeLessThan(8200)
  })

  it('propagates runner failures', async () => {
    const outcome = await runGetGitDiff({ staged: false, relativePath: '' }, async () => ({
      ok: false,
      text: '',
      message: 'git 未安装'
    }))
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('git 未安装')
  })
})
