import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../../shared/errors'

/**
 * 命令策略：内置默认白名单 + 项目级 `.yocim/commands.json` 扩展。
 *
 * 设计原则：
 * - 白名单只决定「允许哪个可执行程序」；git 子命令不受策略层限制，
 *   开放模式直接放行，自动/手动模式交给人工审批（见 ToolService）；
 * - 危险正则始终生效，项目配置无法放开；
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
