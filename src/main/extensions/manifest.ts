import type { ExtensionCompatibility, ExtensionContributions } from '../../shared/extensions'

/** 归一化后的清单：只保留第一层能消费的声明式贡献 */
export interface NormalizedManifest {
  id: string
  name: string
  displayName: string
  version: string
  publisher?: string
  description?: string
  compatibility: ExtensionCompatibility
  compatibilityReason: string
  contributions: ExtensionContributions
  runtimeEntry: string | null
  commands: Array<{ id: string; title: string }>
  snippets: Array<{ language: string; path: string }>
  grammars: Array<{ language: string; scopeName: string; path: string }>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function countMenus(value: unknown): number {
  return Object.keys(asRecord(value)).length
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

/**
 * 解析 `yocim-extension.json` 或 VS Code `package.json` 的贡献。
 * 兼容性分级（§3.6）：
 * - incompatible：声明了 main/browser 运行时代码、debuggers、扩展依赖；
 * - partial：还声明了命令/菜单/快捷键（可映射但需要命令面板）；
 * - declarative：只有语言/语法/片段/主题。
 */
export function normalizeManifest(raw: unknown, hintName?: string): NormalizedManifest | null {
  const root = asRecord(raw)
  if (!Object.keys(root).length) return null

  const manifestId = asRecord(root['yocim'])
  const contributes = asRecord(root['contributes'])
  const name = asText(root['name']) || asText(manifestId['name']) || hintName || ''
  if (!name) return null
  const publisher = asText(root['publisher']) || asText(manifestId['publisher'])
  const displayName = asText(root['displayName']) || asText(manifestId['displayName']) || name
  const version = asText(root['version']) || asText(manifestId['version']) || '0.0.0'
  const description = asText(root['description']) || asText(manifestId['description'])
  const id = sanitizeId(publisher ? `${publisher}.${name}` : name)

  const commandEntries = asArray(contributes['commands'])
    .map((item) => asRecord(item))
    .map((item) => ({ id: asText(item['command']), title: asText(item['title']) }))
    .filter((item) => item.id)
    .slice(0, 200)

  const snippets = asArray(contributes['snippets'])
    .map((item) => asRecord(item))
    .map((item) => ({ language: asText(item['language']) || '*', path: asText(item['path']) }))
    .filter((item) => item.path)
    .slice(0, 200)

  const grammars = asArray(contributes['grammars'])
    .map((item) => asRecord(item))
    .map((item) => ({
      language: asText(item['language']),
      scopeName: asText(item['scopeName']),
      path: asText(item['path'])
    }))
    .filter((item) => item.language && item.path)
    .slice(0, 200)

  const contributions: ExtensionContributions = {
    commands: commandEntries.length,
    menus: countMenus(contributes['menus']),
    keybindings: asArray(contributes['keybindings']).length,
    languages: asArray(contributes['languages']).length,
    grammars: grammars.length,
    snippets: snippets.length,
    themes: asArray(contributes['themes']).length
  }

  const runtimeEntry = asText(root['main']) || asText(root['browser']) || null
  // VS Code 里 debuggers 是数组，非标准清单可能写成对象，两种都算
  const debuggersValue = contributes['debuggers']
  const hasDebuggers = Array.isArray(debuggersValue)
    ? debuggersValue.length > 0
    : Object.keys(asRecord(debuggersValue)).length > 0
  const hasDependencies =
    asArray(root['extensionDependencies']).length > 0 || asArray(root['extensionPack']).length > 0

  let compatibility: ExtensionCompatibility = 'declarative'
  let compatibilityReason = '仅声明式贡献（语言/语法/片段/主题），可直接使用'

  if (runtimeEntry) {
    compatibility = 'incompatible'
    compatibilityReason = `声明了运行时代码入口 ${runtimeEntry}，第一层扩展不执行扩展代码`
  } else if (hasDebuggers) {
    compatibility = 'incompatible'
    compatibilityReason = '声明了 debuggers 贡献，需要调试适配器运行时代码'
  } else if (hasDependencies) {
    compatibility = 'incompatible'
    compatibilityReason =
      '依赖其他扩展（extensionDependencies / extensionPack），需要 Extension Host'
  } else if (contributions.commands || contributions.menus || contributions.keybindings) {
    compatibility = 'partial'
    compatibilityReason = '包含命令/菜单/快捷键，可映射为只读展示，不会执行扩展代码'
  }

  return {
    id,
    name,
    displayName,
    version,
    ...(publisher ? { publisher } : {}),
    ...(description ? { description } : {}),
    compatibility,
    compatibilityReason,
    contributions,
    runtimeEntry,
    commands: commandEntries,
    snippets,
    grammars
  }
}

export { sanitizeId }
