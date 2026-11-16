import type { ToolExecutionOutcome } from '../../shared/agent'
import { AppError } from '../../shared/errors'
import type { WorkspacePathGuard } from '../workspace/pathGuard'
import { runWorkspaceCommand } from './commandRunner'
import type { ToolFileIo } from './toolFileIo'
import type { RunTestsArgs } from './toolSchemas'

export type TestRunnerKind = 'vitest' | 'jest' | 'pytest' | 'go'

const EXCERPT_MAX_CHARS = 2600
const DIFF_MAX_CHARS = 8000

/**
 * 验证类工具（run_tests / run_typecheck / run_lint / get_git_diff）。
 *
 * 设计约束：结果只回结构化摘要（计数 + 失败用例名 + 断言节选），
 * 不把全量日志塞进模型上下文；解析函数保持纯函数以便单测。
 */

// ---------------------------------------------------------------------------
// 测试输出解析（纯函数）
// ---------------------------------------------------------------------------

export interface TestSummary {
  runner: TestRunnerKind
  total: number | null
  passed: number | null
  failed: number | null
  failedNames: string[]
  excerpt: string
}

function count(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text)
  return match ? Number(match[1]) : null
}

/** 取最后一次匹配：vitest 输出里 Test Files 行与 Tests 行都有计数，以最后的汇总行为准 */
function countLast(text: string, pattern: RegExp): number | null {
  const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))]
  const last = matches.at(-1)
  return last ? Number(last[1]) : null
}

/** 通用失败详情提取：从标记行开始截取一块，限制块数与总长度 */
function extractBlocks(
  lines: string[],
  startsBlock: (line: string) => boolean,
  maxLinesPerBlock: number,
  maxBlocks: number
): string[] {
  const blocks: string[] = []
  for (let index = 0; index < lines.length && blocks.length < maxBlocks; index += 1) {
    if (!startsBlock(lines[index])) continue
    const block: string[] = []
    for (let offset = 0; offset < maxLinesPerBlock && index + offset < lines.length; offset += 1) {
      const line = lines[index + offset]
      // 块内遇到下一个块起点就停，避免把整段日志拖进来
      if (offset > 0 && startsBlock(line)) break
      block.push(line)
    }
    blocks.push(block.join('\n'))
    index += block.length - 1
  }
  return blocks
}

function clipExcerpt(blocks: string[]): string {
  let excerpt = ''
  for (const block of blocks) {
    if (excerpt.length + block.length > EXCERPT_MAX_CHARS) {
      excerpt += `\n${block.slice(0, Math.max(0, EXCERPT_MAX_CHARS - excerpt.length))}…`
      break
    }
    excerpt += `${excerpt ? '\n\n' : ''}${block}`
  }
  return excerpt
}

export function summarizeTestOutput(runner: TestRunnerKind, output: string): TestSummary {
  const lines = output.split(/\r?\n/)

  if (runner === 'vitest' || runner === 'jest') {
    const failedNames = lines
      .filter((line) => /^\s*(?:[×✕✗]|FAIL)\s+/.test(line))
      .map((line) => line.replace(/^\s*(?:[×✕✗]|FAIL)\s+/, '').trim())
      .filter(Boolean)
    const detailBlocks = extractBlocks(
      lines,
      (line) => line.includes('●') || /^\s*[×✕✗]\s+/.test(line),
      14,
      3
    )
    return {
      runner,
      total: count(output, /(\d+)\s+total|total\s*[:：]?\s*(\d+)/),
      passed: countLast(output, /(\d+)\s+passed/),
      failed: countLast(output, /(\d+)\s+failed/),
      failedNames: [...new Set(failedNames)].slice(0, 10),
      excerpt: clipExcerpt(detailBlocks)
    }
  }

  if (runner === 'pytest') {
    const failedNames = lines
      .filter((line) => /^FAILED\s+/.test(line.trim()))
      .map(
        (line) =>
          line
            .trim()
            .replace(/^FAILED\s+/, '')
            .split(/\s+-\s+/)[0]
      )
    const detailBlocks = extractBlocks(lines, (line) => /^_{5,}\s/.test(line.trim()), 18, 2)
    return {
      runner,
      total: count(output, /(\d+)\s+items? selected|collected\s+(\d+)\s+items?/),
      passed: count(output, /(\d+)\s+passed/),
      failed: count(output, /(\d+)\s+failed/),
      failedNames: [...new Set(failedNames)].slice(0, 10),
      excerpt: clipExcerpt(detailBlocks)
    }
  }

  // go test
  const failedNames = lines
    .map((line) => /^--- FAIL:\s*(\S+)/.exec(line.trim())?.[1] ?? '')
    .filter(Boolean)
  const detailBlocks = extractBlocks(lines, (line) => /^--- FAIL:/.test(line.trim()), 10, 3)
  return {
    runner: 'go',
    total: null,
    passed: count(output, /(\d+)\s+pass|---\s+PASS:/),
    failed: failedNames.length || null,
    failedNames: [...new Set(failedNames)].slice(0, 10),
    excerpt: clipExcerpt(detailBlocks)
  }
}

function formatTestContent(summary: TestSummary, ok: boolean): string {
  if (ok) {
    const passed = summary.passed ?? 0
    return `[${summary.runner}] 测试全部通过：${passed} 个测试。`
  }
  const parts: string[] = [`[${summary.runner}] 测试未全部通过。`]
  const counts = [
    summary.total !== null ? `总计 ${summary.total}` : '',
    summary.passed !== null ? `通过 ${summary.passed}` : '',
    summary.failed !== null ? `失败 ${summary.failed}` : ''
  ].filter(Boolean)
  if (counts.length) parts.push(counts.join(' | '))
  if (summary.failedNames.length) {
    parts.push(`失败用例（${summary.failedNames.length}）：`)
    for (const name of summary.failedNames) parts.push(`- ${name}`)
  }
  if (summary.excerpt) {
    parts.push('失败详情（节选）：')
    parts.push(summary.excerpt)
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Runner 探测
// ---------------------------------------------------------------------------

async function readJsonFile(io: ToolFileIo, relativePath: string): Promise<unknown | null> {
  try {
    const file = await io.read(relativePath)
    return JSON.parse(file.content)
  } catch {
    return null
  }
}

async function fileExists(io: ToolFileIo, relativePath: string): Promise<boolean> {
  try {
    await io.read(relativePath)
    return true
  } catch {
    return false
  }
}

export async function detectTestRunner(io: ToolFileIo): Promise<TestRunnerKind | null> {
  const pkg = (await readJsonFile(io, 'package.json')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  } | null
  if (pkg) {
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    if (all['vitest']) return 'vitest'
    if (all['jest']) return 'jest'
  }
  if (await fileExists(io, 'go.mod')) return 'go'
  for (const file of ['pytest.ini', 'conftest.py', 'pyproject.toml']) {
    if (await fileExists(io, file)) return 'pytest'
  }
  return null
}

function buildTestCommand(runner: TestRunnerKind, pattern: string): string {
  const suffix = pattern ? ` ${pattern}` : ''
  switch (runner) {
    case 'vitest':
      return `npx vitest run${suffix}`
    case 'jest':
      return `npx jest${suffix}`
    case 'pytest':
      return `python -m pytest${suffix ? ` ${pattern}` : ''} -q`
    case 'go':
      return pattern ? `go test -run ${pattern}/... ./...` : 'go test ./...'
  }
}

// ---------------------------------------------------------------------------
// 诊断输出解析（tsc / eslint-unix，纯函数）
// ---------------------------------------------------------------------------

export interface DiagnosticSummary {
  entries: string[]
  total: number
}

const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*(.*)$/
const UNIX_LINE = /^(.+?):(\d+):(\d+):\s*(.*)$/

export function parseDiagnostics(output: string): DiagnosticSummary {
  const entries: string[] = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const tsc = TSC_LINE.exec(line)
    if (tsc) {
      entries.push(`${tsc[1]}:${tsc[2]}:${tsc[3]} ${tsc[4]} ${tsc[5]}`)
      continue
    }
    const unix = UNIX_LINE.exec(line)
    if (unix && !/^\s*at /.test(line)) {
      entries.push(`${unix[1]}:${unix[2]}:${unix[3]} ${unix[4]}`)
    }
  }
  return { entries, total: entries.length }
}

function formatDiagnostics(kind: string, summary: DiagnosticSummary, maxEntries = 50): string {
  if (summary.total === 0) return `${kind}通过：未发现问题。`
  const shown = summary.entries.slice(0, maxEntries)
  const suffix =
    summary.total > shown.length ? `\n（共 ${summary.total} 处，已显示前 ${shown.length} 条）` : ''
  return `${kind}发现 ${summary.total} 处问题：\n${shown.join('\n')}${suffix}`
}

// ---------------------------------------------------------------------------
// 工具入口
// ---------------------------------------------------------------------------

export interface VerifyRunOptions {
  signal: AbortSignal
  onOutput?: (text: string) => void
}

async function execVerifyCommand(
  guard: WorkspacePathGuard,
  command: string,
  cwd: string,
  timeoutMs: number,
  options: VerifyRunOptions
): Promise<ToolExecutionOutcome> {
  const resolved = await guard.resolve(cwd, { mustExist: true })
  return runWorkspaceCommand(command, {
    cwd: resolved.absolutePath,
    timeoutMs,
    signal: options.signal,
    onOutput: options.onOutput
  })
}

export async function runRunTests(
  io: ToolFileIo,
  guard: WorkspacePathGuard,
  args: RunTestsArgs,
  options: VerifyRunOptions
): Promise<ToolExecutionOutcome> {
  const runner = args.runner ?? (await detectTestRunner(io))
  if (!runner) {
    throw new AppError(
      'E_UNSUPPORTED',
      '未能识别测试框架：请确认项目包含 vitest/jest/pytest/go，或通过 runner 参数指定'
    )
  }
  const command = buildTestCommand(runner, args.pattern ?? '')
  const raw = await execVerifyCommand(
    guard,
    command,
    args.cwd ?? '',
    args.timeoutMs ?? 120_000,
    options
  )
  const summary = summarizeTestOutput(runner, raw.content)
  return {
    ok: raw.ok && (summary.failed ?? 0) === 0,
    content: formatTestContent(summary, raw.ok),
    summary: raw.ok
      ? `测试通过：${summary.passed ?? 0} 个`
      : `测试失败：${summary.failedNames[0] ?? `${summary.failed ?? 0} 个失败`}`
  }
}

export async function runRunTypecheck(
  io: ToolFileIo,
  guard: WorkspacePathGuard,
  args: { cwd?: string; timeoutMs?: number },
  options: VerifyRunOptions
): Promise<ToolExecutionOutcome> {
  if (!(await fileExists(io, 'tsconfig.json'))) {
    throw new AppError('E_UNSUPPORTED', '未找到 tsconfig.json，无法运行类型检查')
  }
  const raw = await execVerifyCommand(
    guard,
    'npx tsc --noEmit',
    args.cwd ?? '',
    args.timeoutMs ?? 180_000,
    options
  )
  const summary = parseDiagnostics(raw.content)
  const errors = summary.entries.filter((entry) => /\berror\b/.test(entry)).length
  return {
    ok: raw.ok && errors === 0,
    content: formatDiagnostics('类型检查', summary),
    summary: errors > 0 ? `类型错误 ${errors} 处` : '类型检查通过'
  }
}

const ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.eslintrc.yaml'
]

export async function runRunLint(
  io: ToolFileIo,
  guard: WorkspacePathGuard,
  args: { relativePath?: string; cwd?: string; timeoutMs?: number },
  options: VerifyRunOptions
): Promise<ToolExecutionOutcome> {
  const hasConfig = await (async (): Promise<boolean> => {
    for (const file of ESLINT_CONFIGS) {
      if (await fileExists(io, file)) return true
    }
    return false
  })()
  if (!hasConfig) {
    throw new AppError('E_UNSUPPORTED', '未找到 ESLint 配置文件，无法运行 lint')
  }
  const target = args.relativePath?.trim() || '.'
  const raw = await execVerifyCommand(
    guard,
    `npx eslint ${target} --format unix`,
    args.cwd ?? '',
    args.timeoutMs ?? 180_000,
    options
  )
  const summary = parseDiagnostics(raw.content)
  return {
    ok: raw.ok && summary.total === 0,
    content: formatDiagnostics('Lint', summary),
    summary: summary.total > 0 ? `Lint 问题 ${summary.total} 处` : 'Lint 通过'
  }
}

export interface GitDiffRunnerArgs {
  staged: boolean
  relativePath: string
}

export interface GitDiffRunnerResult {
  ok: boolean
  text: string
  message?: string
}

export type GitDiffRunner = (args: GitDiffRunnerArgs) => Promise<GitDiffRunnerResult>

export async function runGetGitDiff(
  args: GitDiffRunnerArgs,
  runner: GitDiffRunner
): Promise<ToolExecutionOutcome> {
  const result = await runner(args)
  if (!result.ok) {
    return {
      ok: false,
      content: `获取 diff 失败：${result.message ?? '未知原因'}`,
      summary: '获取 diff 失败'
    }
  }
  if (!result.text.trim()) {
    return {
      ok: true,
      content: args.staged ? '暂存区没有改动。' : '当前没有未提交的改动。',
      summary: '无改动'
    }
  }
  const truncated =
    result.text.length > DIFF_MAX_CHARS
      ? `${result.text.slice(0, DIFF_MAX_CHARS)}…\n[diff 已截断]`
      : result.text
  return {
    ok: true,
    content: truncated,
    summary: `diff ${result.text.length > DIFF_MAX_CHARS ? '（已截断）' : ''}已返回`
  }
}
