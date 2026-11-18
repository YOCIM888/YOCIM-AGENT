import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import { isCommandWhitelisted } from '../../shared/settings'

/**
 * 命令策略：内置默认白名单 + 项目级 `.yocim/commands.json` 扩展。
 *
 * 设计原则：
 * - 白名单只决定「允许哪个可执行程序」；git 子命令不受策略层限制，
 *   开放模式直接放行，自动/手动模式交给人工审批（见 ToolService）；
 * - 危险正则默认始终生效；仅开放模式下用户显式加入命令白名单的命令可放行；
 * - `.yocim/commands.json` 是项目内约定文件，格式 `{ "allow": ["uv", "mix"] }`
 *   或直接字符串数组；最多 50 条，仅接受安全的可执行名。
 */

export const DEFAULT_ALLOWED_COMMANDS = new Set([
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'tsc',
  'vitest',
  'git',
  'python',
  'python3',
  'pytest',
  'cargo',
  'go',
  'make',
  'dotnet',
  'gradle'
])

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-[a-z]*r[a-z]*f\b/i, reason: '递归强制删除' },
  { pattern: /\brm\s+-rf\b/i, reason: '递归强制删除' },
  {
    pattern: /\b(?:format|mkfs(?:\.\w+)?|diskpart|shutdown|reboot|halt)\b/i,
    reason: '系统级危险命令'
  },
  { pattern: /\breg\s+delete\b/i, reason: '删除注册表' },
  { pattern: /\bdel\s+\/f\s+\/s\b/i, reason: '递归强制删除' },
  { pattern: /\bremove-item\b[^\n]*-recurse/i, reason: '递归删除（PowerShell）' },
  { pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba|z|k)?sh\b/i, reason: '下载并执行远程脚本' },
  { pattern: /\b(?:iwr|invoke-webrequest)\b[^\n|]*\|\s*iex\b/i, reason: '下载并执行远程脚本' }
]

/** 项目自定义命令名：字母开头，仅字母数字与 . - _，长度 ≤ 64 */
const COMMAND_NAME_PATTERN = /^[a-zA-Z][\w.-]{0,63}$/
const MAX_PROJECT_COMMANDS = 50

export interface ProjectCommandsFile {
  allow?: unknown
}

/**
 * 读取项目级命令白名单扩展（`.yocim/commands.json`）。
 * 文件不存在返回空集；格式非法抛错（让模型看到明确原因而不是静默忽略）。
 */
export async function loadProjectCommands(root: string): Promise<Set<string>> {
  const file = path.join(root, '.yocim', 'commands.json')
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return new Set()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AppError('E_INVALID_INPUT', '.yocim/commands.json 不是合法 JSON')
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as ProjectCommandsFile).allow)
      ? ((parsed as ProjectCommandsFile).allow as unknown[])
      : null
  if (!list) {
    throw new AppError(
      'E_INVALID_INPUT',
      '.yocim/commands.json 格式应为 {"allow": ["命令", ...]} 或字符串数组'
    )
  }

  const allowed = new Set<string>()
  for (const item of list.slice(0, MAX_PROJECT_COMMANDS)) {
    if (typeof item !== 'string') continue
    const name = item.trim().toLowerCase()
    if (name && COMMAND_NAME_PATTERN.test(name)) allowed.add(name)
  }
  return allowed
}

export function assertCommandAllowed(command: string, allowed: ReadonlySet<string>): void {
  const trimmed = command.trim()
  if (!trimmed) {
    throw new AppError('E_TOOL_DENIED', '命令为空')
  }
  if (trimmed.length > 2000) {
    throw new AppError('E_TOOL_DENIED', '命令过长')
  }
  if (trimmed.includes('\0')) {
    throw new AppError('E_TOOL_DENIED', '命令包含非法字符')
  }

  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new AppError('E_TOOL_DENIED', `危险命令已拒绝：${reason}`)
    }
  }

  const tokens = trimmed.split(/\s+/)
  const executable = tokens[0].toLowerCase()
  if (!allowed.has(executable)) {
    throw new AppError(
      'E_TOOL_DENIED',
      `命令不在白名单：${tokens[0]}。可在 .yocim/commands.json 中扩展（{"allow": ["${tokens[0]}"]}）`
    )
  }
}

/* -------------------------------------------------------------------------- */
/* run_command 专用：shell 解析 + 逐段校验                                     */
/* -------------------------------------------------------------------------- */

export type ShellParseResult =
  | { ok: true; segments: string[] }
  | { ok: false; reason: string }

type ExpandResult = { ok: true; value: string } | { ok: false; reason: string }

/**
 * cmd.exe 在解析运算符之前先展开 %VAR%，变量内容里若带 & / | 就会注入新命令。
 * 因此校验前按当前环境预展开；无法在校验时确定取值的动态变量（CD / RANDOM 等）
 * 一律拒绝，不把未知内容当成字面量放过。
 */
function expandCmdVariables(command: string): ExpandResult {
  let out = ''
  let i = 0
  while (i < command.length) {
    const ch = command[i]
    if (ch === '%') {
      if (command[i + 1] === '%') {
        out += '%'
        i += 2
        continue
      }
      const end = command.indexOf('%', i + 1)
      if (end > i + 1) {
        const name = command.slice(i + 1, end)
        const value = process.env[name]
        if (value === undefined) {
          return {
            ok: false,
            reason: `环境变量 %${name}% 在校验时无法确定取值，已拒绝以避免注入`
          }
        }
        out += value
        i = end + 1
        continue
      }
    }
    // 延迟展开同样不可预测（默认关闭，但命令里显式 /v 时会影响解析）
    if (ch === '!') {
      const end = command.indexOf('!', i + 1)
      if (end > i + 1 && /^[A-Za-z_]\w*$/.test(command.slice(i + 1, end))) {
        return { ok: false, reason: '延迟环境变量展开 !VAR! 已拒绝' }
      }
    }
    out += ch
    i++
  }
  return { ok: true, value: out }
}

/**
 * 把 shell 字符串切成「简单命令段」，供逐段做白名单 / 危险正则校验。
 *
 * 设计原则：保守解析、失败即拒绝。只识别两种 shell 的运算符与引号规则，
 * 遇到无法确信解析的构造（命令替换、子 shell、未闭合引号、不可展开变量）
 * 直接返回 reason，交给上层按开放模式 blocked 审批卡处理。
 * 重定向（> / <）不切段：它不引入新可执行文件，且其目标由 shell 处理；
 * 是否限制写入目标属于上层策略，不在本解析层解决。
 */
export function parseShellCommand(
  command: string,
  platform: NodeJS.Platform = process.platform
): ShellParseResult {
  const isWin = platform === 'win32'
  let source = command
  if (isWin) {
    const expanded = expandCmdVariables(command)
    if (!expanded.ok) return expanded
    source = expanded.value
  }

  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let i = 0

  const flush = (): void => {
    const trimmed = current.trim()
    if (trimmed) segments.push(trimmed)
    current = ''
  }

  while (i < source.length) {
    const ch = source[i]

    if (!isWin) {
      // POSIX 单引号内一切都是字面量（包括 $ 和反引号）
      if (quote === "'") {
        if (ch === "'") quote = null
        else current += ch
        i++
        continue
      }
      if (ch === '\\') {
        if (i + 1 >= source.length) {
          return { ok: false, reason: '末尾的反斜杠转义无法安全解析' }
        }
        current += ch + source[i + 1]
        i += 2
        continue
      }
      if (ch === '`') return { ok: false, reason: '反引号命令替换已拒绝' }
      if (ch === '$' && source[i + 1] === '(') {
        return { ok: false, reason: '$() 命令替换已拒绝' }
      }
      if (ch === '"') {
        quote = quote === '"' ? null : quote === null ? '"' : quote
        i++
        continue
      }
      if (quote === null && ch === "'") {
        quote = "'"
        i++
        continue
      }
      // 2>&1 / <&- 这类重定向里的 & 不是命令分隔符
      const redirectionAmp =
        source[i - 1] === '>' || source[i - 1] === '<' || source[i + 1] === '>'
      if (quote === null && !redirectionAmp && (ch === ';' || ch === '|' || ch === '&' || ch === '\n')) {
        flush()
        if ((ch === '|' || ch === '&') && source[i + 1] === ch) i += 2
        else i++
        continue
      }
      if (quote === null && (ch === '(' || ch === ')')) {
        return { ok: false, reason: '子 shell / 分组语法已拒绝' }
      }
      current += ch
      i++
      continue
    }

    // Windows cmd.exe：单引号不是引号，^ 才是转义符
    if (ch === '^' && quote === null) {
      if (i + 1 >= source.length) {
        return { ok: false, reason: '末尾的 ^ 转义无法安全解析' }
      }
      current += source[i + 1]
      i += 2
      continue
    }
    if (ch === '"') {
      quote = quote === '"' ? null : quote === null ? '"' : quote
      current += ch
      i++
      continue
    }
    // cmd 同样用 2>&1，& 紧跟重定向符时按字面量处理
    const redirectionAmp =
      source[i - 1] === '>' || source[i - 1] === '<' || source[i + 1] === '>'
    if (quote === null && !redirectionAmp && (ch === '&' || ch === '|' || ch === '\n')) {
      flush()
      if ((ch === '&' || ch === '|') && source[i + 1] === ch) i += 2
      else i++
      continue
    }
    if (quote === null && (ch === '(' || ch === ')')) {
      return { ok: false, reason: 'cmd 分组语法已拒绝' }
    }
    current += ch
    i++
  }

  if (quote !== null) return { ok: false, reason: '引号未闭合，已拒绝' }
  flush()
  return { ok: true, segments }
}

function segmentExecutable(segment: string, isWin: boolean): string {
  let rest = segment.trim()
  // POSIX 前置环境变量赋值（FOO=bar npm test）不是可执行名
  while (!isWin) {
    const assignment = /^[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+/.exec(rest)
    if (!assignment) break
    rest = rest.slice(assignment[0].length).trim()
  }
  const token = rest.split(/\s+/)[0] ?? ''
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1)
  }
  return token
}

/**
 * run_command 的策略入口：先走原有整条检查，再解析 shell 段并逐段校验。
 * 任一段的可执行名不在白名单、或命中危险正则即拒绝；开放模式下由
 * toolService 把这里抛出的错误转成 kind='blocked' 审批卡。
 */
export function assertShellCommandAllowed(
  command: string,
  allowed: ReadonlySet<string>,
  platform: NodeJS.Platform = process.platform
): void {
  assertCommandAllowed(command, allowed)

  const parsed = parseShellCommand(command, platform)
  if (!parsed.ok) {
    throw new AppError('E_TOOL_DENIED', `shell 命令已拒绝：${parsed.reason}`)
  }

  for (const segment of parsed.segments) {
    const executable = segmentExecutable(segment, platform === 'win32')
    if (!executable) continue
    if (!allowed.has(executable.toLowerCase())) {
      throw new AppError(
        'E_TOOL_DENIED',
        `命令不在白名单：${executable}。shell 命令的每一段都必须通过白名单；可在 .yocim/commands.json 中扩展`
      )
    }
    for (const { pattern, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(segment)) {
        throw new AppError('E_TOOL_DENIED', `危险命令已拒绝：${reason}`)
      }
    }
  }
}

/**
 * 开放模式免审批判定：整条命令精确命中白名单，或切分后每一段都命中。
 * 不能沿用 shared/settings 的「只匹配首个可执行名」，否则
 * `npm test && rm -r /` 会因为 npm 命中白名单而整条跳过校验。
 */
export function isOpenModeShellWhitelisted(
  command: string,
  whitelist: readonly string[],
  platform: NodeJS.Platform = process.platform
): boolean {
  const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase()
  const normalized = normalize(command)
  if (!normalized) return false

  // 含不可安全解析的构造时，即便整条被精确加入白名单也不免审批
  const parsed = parseShellCommand(command, platform)
  if (!parsed.ok || parsed.segments.length === 0) return false
  if (whitelist.some((entry) => normalize(entry) === normalized)) return true

  return parsed.segments.every((segment) => isCommandWhitelisted(segment, whitelist))
}
