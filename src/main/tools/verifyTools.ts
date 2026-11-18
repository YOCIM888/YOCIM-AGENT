import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ToolExecutionOutcome } from '../../shared/agent'
import { AppError } from '../../shared/errors'
import type { WorkspacePathGuard } from '../workspace/pathGuard'
import { runWorkspaceCommandArgv } from './commandRunner'
import type { ToolFileIo } from './toolFileIo'
import type { RunTestsArgs } from './toolSchemas'

export type TestRunnerKind = 'vitest' | 'jest' | 'pytest' | 'go'

const EXCERPT_MAX_CHARS = 2600
const DIFF_MAX_CHARS = 8000

/**
 * 验证工具参数安全边界。
 *
 * run_tests 的 pattern / run_lint 的 relativePath 由模型给出，历史上被直接拼进
 * `spawn(shell:true)` 的命令串，一个 `;` 就能追加任意 shell 命令且完全绕过审批。
 * 这里做两层防护：
 *  1) 命令一律改成 argv 数组 + `shell:false`（见 commandRunner），shell 元字符
 *     即使漏进来也只是普通参数，不会被解释成命令分隔符；
 *  2) 参数本身再用字符白名单约束，既是纵深防御，也让传给测试框架的内容保持
 *     在「文件名 / 正则片段」的合理范围（并挡住 --fix / -u 这类改写型 flag）。
 */
const SAFE_ARG_PATTERN = /^[\w./\\*,\- ]+$/

/**
 * 校验一个将被放进验证命令用户输入位的值。
 * 仅允许字母数字（含 Unicode 词字符）、下划线、点、斜杠、反斜杠、星号、逗号、连字符与空格。
 * 拒绝 ; | & $ ` ( ) < > " ' \n \r 等一切 shell 元字符与引号。
 */
export function assertSafeVerifyArg(value: string, label: string): void {
  if (!SAFE_ARG_PATTERN.test(value)) {
    throw new AppError(
      'E_INVALID_INPUT',
      `${label} 含不允许的字符（仅支持字母、数字、路径分隔符、*、逗号、连字符与空格）`
    )
  }
  // 即使已无 shell，以 - 开头的 token 仍会被 eslint/vitest 当成选项：
  // `eslint --fix` 会改写源码、`vitest -u` 会更新快照，二者都绕过写文件审批。
  // 用户参数只应是路径 / 测试名 / 正则片段，一律不接受选项形式。
  if (/(^|\s)-/.test(value)) {
    throw new AppError('E_INVALID_INPUT', `${label} 不允许以 - 开头的选项参数（如 --fix、-u）`)
  }
}

/**
 * 在审批前校验验证工具的所有模型可控参数，确保审批卡展示的命令与最终执行一致，
 * 且注入字符在更早的策略阶段就被拒绝（而不必等到执行期）。
 */
export function assertVerifyToolArgs(args: {
  tool: string
  pattern?: string
  relativePath?: string
}): void {
  if (args.tool === 'run_tests' && args.pattern) assertSafeVerifyArg(args.pattern, 'pattern')
  if (args.tool === 'run_lint' && args.relativePath?.trim()) {
    assertSafeVerifyArg(args.relativePath.trim(), 'relativePath')
  }
}

/**
 * 定位系统安装的 npx-cli.js，用 process.execPath + ELECTRON_RUN_AS_NODE 直接驱动，
 * 从而在不启用 shell 的情况下解析工作区本地依赖（Windows 上 npx 是 .cmd，无法无 shell 执行）。
 *
 * 不能只看 process.execPath 的同级目录：开发期它是 node.exe（npm 就在旁边），
 * 但打包后是 electron.exe（旁边没有 npm）。因此按优先级探测：
 *   1) process.execPath 同级 node_modules/npm/bin（开发 / Node 直跑）；
 *   2) PATH 上 npx shim 的同级 node_modules/npm/bin（打包后，依赖用户机器的 Node）。
 * npx shim（Unix 无扩展名 / Windows .cmd）内容形如 `"%~dp0\\node.exe" ... npx-cli.js`，
 * 其目录即 npm 安装根目录，npx-cli.js 固定在 <root>/node_modules/npm/bin 下。
 */
function resolveNpxCli(): string {
  const candidates: string[] = []
  // 1) 与当前可执行文件同安装前缀
  candidates.push(
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
  )
  // 2) PATH 上每个 npx shim 的同级安装前缀
  const pathVar = process.env.PATH ?? process.env.Path ?? ''
  for (const entry of pathVar.split(path.delimiter)) {
    if (!entry) continue
    for (const shim of ['npx', 'npx.cmd']) {
      const shimPath = path.join(entry, shim)
      if (existsSync(shimPath)) {
        candidates.push(
          path.join(entry, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
          // Windows 上 shim 也可能在 node.exe 同级但 npm 在 <dir>/node_modules
          path.resolve(entry, '..', 'node_modules', 'npm', 'bin', 'npx-cli.js')
        )
      }
    }
  }
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new AppError(
      'E_UNSUPPORTED',
      '未找到 npx：验证工具需要本机安装 Node/npm（用于运行本地测试与检查工具）'
    )
  }
  return found
}

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

/**
 * 构造测试命令的 argv 数组（argv[0] 为可执行文件）。
 * 不再返回可拼接的字符串：用户输入（pattern）是独立argv元素，且经过字符白名单校验，
 * 因此不存在命令注入面。node/npx-cli 组合用于跨平台在不启用 shell 的情况下解析
 * 工作区本地安装的工具（Windows 上 npx 是 .cmd，无法在 shell:false 下直接执行）。
 */
export function buildTestArgv(runner: TestRunnerKind, pattern: string): string[] {
  if (pattern) assertSafeVerifyArg(pattern, 'pattern')
  const npx = (...args: string[]): string[] => [process.execPath, resolveNpxCli(), ...args]
  switch (runner) {
    case 'vitest':
      return npx('vitest', 'run', ...(pattern ? [pattern] : []))
    case 'jest':
      return npx('jest', ...(pattern ? [pattern] : []))
    case 'pytest':
      return ['python', '-m', 'pytest', ...(pattern ? [pattern] : []), '-q']
    case 'go':
      return pattern ? ['go', 'test', '-run', `${pattern}/...`, './...'] : ['go', 'test', './...']
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
  argv: string[],
  cwd: string,
  timeoutMs: number,
  options: VerifyRunOptions
): Promise<ToolExecutionOutcome> {
  const resolved = await guard.resolve(cwd, { mustExist: true })
  return runWorkspaceCommandArgv(argv, {
    cwd: resolved.absolutePath,
    timeoutMs,
    signal: options.signal,
    onOutput: options.onOutput,
    // Electron 主进程里 process.execPath 是 electron.exe；用 argv 驱动 npx-cli.js
    // 时必须让它以 Node 身份运行（与 debug 适配器一致）。
    env: argv[0] === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : undefined
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
  const argv = buildTestArgv(runner, args.pattern ?? '')
  const raw = await execVerifyCommand(
    guard,
    argv,
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
    [process.execPath, resolveNpxCli(), 'tsc', '--noEmit'],
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
  assertSafeVerifyArg(target, 'relativePath')
  const raw = await execVerifyCommand(
    guard,
    [process.execPath, resolveNpxCli(), 'eslint', target, '--format', 'unix'],
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
