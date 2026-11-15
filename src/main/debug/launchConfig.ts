import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { AppError } from '../../shared/errors'
import { DEBUG_LIMITS } from '../../shared/ipcChannels'
import type { DebugConfig, DebugConfigFile } from '../../shared/debug'

export const LAUNCH_FILE = '.yocim/launch.json'

export interface VariableContext {
  workspaceRoot: string
  /** 当前活动文件的绝对路径 */
  activeFile?: string
}

const VARIABLE_PATTERN = /\$\{([^}]+)\}/g

/**
 * 展开 `${workspaceFolder}` / `${file}` / `${workspaceFolderBasename}` / `${env:NAME}`。
 * 未知变量原样保留（便于用户排查拼写），`${file}` 缺少活动文件时给出可读错误。
 */
export function resolveDebugVariables(value: string, context: VariableContext): string {
  return value.replace(VARIABLE_PATTERN, (match, rawName: string) => {
    const name = rawName.trim()
    if (name === 'workspaceFolder') return context.workspaceRoot
    if (name === 'workspaceFolderBasename') {
      return context.workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? context.workspaceRoot
    }
    if (name === 'file') {
      if (!context.activeFile) {
        throw new AppError('E_INVALID_INPUT', '启动配置使用了 ${file}，但当前没有打开的文件')
      }
      return context.activeFile
    }
    if (name.startsWith('env:')) {
      const key = name.slice(4).trim()
      return process.env[key] ?? ''
    }
    return match
  })
}

function asStringArray(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, max)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.slice(0, maxLength))
}

function asEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item === 'string')
    .slice(0, DEBUG_LIMITS.maxEnvEntries)
  if (!entries.length) return undefined
  return Object.fromEntries(entries.map(([key, item]) => [key, String(item)]))
}

/** 把 launch.json 的一条 configuration 归一化成 DebugConfig */
export function normalizeLaunchConfig(raw: unknown, index: number): DebugConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>
  if (entry.type !== 'node' && entry.type !== 'pwa-node') return null
  const program = typeof entry.program === 'string' ? entry.program.trim() : ''
  if (!program) return null
  const name =
    typeof entry.name === 'string' && entry.name.trim()
      ? entry.name.trim().slice(0, 120)
      : `Node 配置 ${index + 1}`
  const cwd = typeof entry.cwd === 'string' && entry.cwd.trim() ? entry.cwd.trim() : undefined
  return {
    id: `launch:${index}`,
    name,
    type: 'node',
    program,
    args: asStringArray(entry.args, DEBUG_LIMITS.maxArgs, DEBUG_LIMITS.maxArgLength),
    ...(cwd ? { cwd } : {}),
    ...(asEnv(entry.env) ? { env: asEnv(entry.env) } : {}),
    runtimeArgs: asStringArray(entry.runtimeArgs, DEBUG_LIMITS.maxArgs, DEBUG_LIMITS.maxArgLength),
    stopOnEntry: entry.stopOnEntry === true,
    source: 'launch.json',
    detail: LAUNCH_FILE
  }
}

/** package.json 的 `main` 字段生成一条零配置启动项 */
export function configFromPackageMain(packageJson: unknown): DebugConfig | null {
  if (!packageJson || typeof packageJson !== 'object') return null
  const main = (packageJson as { main?: unknown }).main
  if (typeof main !== 'string' || !main.trim()) return null
  if (!/\.(c|m)?js$/i.test(main.trim())) return null
  return {
    id: 'pkg:main',
    name: `启动 ${main.trim()}`,
    type: 'node',
    program: main.trim(),
    args: [],
    runtimeArgs: [],
    stopOnEntry: false,
    source: 'package.json',
    detail: 'package.json main'
  }
}

export interface LaunchPlan {
  program: string
  args: string[]
  runtimeArgs: string[]
  cwd: string
  env: Record<string, string>
  /** 展示给用户确认的命令行（不含环境变量值） */
  commandLine: string
}

function quote(arg: string): string {
  return /[\s"']/.test(arg) ? `"${arg}"` : arg
}

function resolveInsideWorkspace(root: string, value: string): string {
  if (isAbsolute(value)) return value
  const resolved = resolve(root, value)
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new AppError('E_PATH_ESCAPE', '启动配置的路径超出了工作区范围')
  }
  return resolved
}

/** 把 DebugConfig 展开成可直接 spawn 的启动计划（路径全部转绝对路径） */
export function buildLaunchPlan(config: DebugConfig, context: VariableContext): LaunchPlan {
  const program = resolveInsideWorkspace(
    context.workspaceRoot,
    resolveDebugVariables(config.program, context)
  )
  const args = config.args.map((item) => resolveDebugVariables(item, context))
  const runtimeArgs = (config.runtimeArgs ?? []).map((item) => resolveDebugVariables(item, context))
  const cwd = config.cwd
    ? resolveInsideWorkspace(context.workspaceRoot, resolveDebugVariables(config.cwd, context))
    : context.workspaceRoot
  const env = Object.fromEntries(
    Object.entries(config.env ?? {}).map(([key, value]) => [
      key,
      resolveDebugVariables(value, context)
    ])
  )
  const commandLine = ['node', ...runtimeArgs, program, ...args].map(quote).join(' ')
  return { program, args, runtimeArgs, cwd: cwd || join(context.workspaceRoot), env, commandLine }
}

/** 读取 `.yocim/launch.json`；不存在返回空列表，格式错误给出可读提示 */
export async function readLaunchConfigs(root: string): Promise<DebugConfigFile> {
  const absolute = join(root, LAUNCH_FILE)
  const text = await readFile(absolute, 'utf8').catch((): null => null)

  const configs: DebugConfig[] = []
  let error: string | undefined
  let path: string | null = null

  if (text) {
    path = LAUNCH_FILE
    try {
      const parsed = JSON.parse(text) as { configurations?: unknown }
      const list = Array.isArray(parsed.configurations) ? parsed.configurations : []
      list.slice(0, DEBUG_LIMITS.maxConfigs).forEach((raw, index) => {
        const config = normalizeLaunchConfig(raw, index)
        if (config) configs.push(config)
      })
    } catch {
      error = `${LAUNCH_FILE} 不是合法 JSON，已忽略其中的启动配置`
    }
  }

  try {
    const packageText = await readFile(join(root, 'package.json'), 'utf8')
    const fromMain = configFromPackageMain(JSON.parse(packageText))
    if (fromMain && !configs.some((item) => item.name === fromMain.name)) configs.push(fromMain)
  } catch {
    // 没有 package.json 或不可解析时忽略
  }

  return { path, configs, ...(error ? { error } : {}) }
}
