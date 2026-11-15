import type { ExtensionSnippet } from '../../shared/extensions'

interface RawSnippet {
  prefix?: unknown
  body?: unknown
  description?: unknown
  scope?: unknown
}

function normalizeBody(body: unknown): string {
  if (Array.isArray(body)) return body.filter((item) => typeof item === 'string').join('\n')
  return typeof body === 'string' ? body : ''
}

/**
 * 解析 VS Code 片段文件：
 * `{ "名字": { "prefix": "log", "body": ["console.log($1)"], "scope": "javascript" } }`
 * 目前只做补全插入，不处理 `${1:占位}` 之外的片段语法（原文插入，不执行变量）。
 */
export function parseSnippetFile(
  text: string,
  options: { extensionId: string; extensionName: string; language: string }
): ExtensionSnippet[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []

  const snippets: ExtensionSnippet[] = []
  for (const [label, value] of Object.entries(raw as Record<string, RawSnippet>)) {
    if (!value || typeof value !== 'object') continue
    const prefixValue = value.prefix
    const prefix = Array.isArray(prefixValue)
      ? prefixValue.filter((item) => typeof item === 'string').join(',')
      : typeof prefixValue === 'string'
        ? prefixValue
        : ''
    const body = normalizeBody(value.body)
    if (!prefix || !body) continue
    const scope = typeof value.scope === 'string' ? value.scope.trim() : ''
    const language = options.language && options.language !== '*' ? options.language : scope || '*'
    snippets.push({
      extensionId: options.extensionId,
      extensionName: options.extensionName,
      language,
      label: label.slice(0, 120),
      prefix: prefix.slice(0, 60),
      body: body.slice(0, 4000),
      ...(typeof value.description === 'string'
        ? { description: value.description.slice(0, 200) }
        : {})
    })
    if (snippets.length >= 400) break
  }
  return snippets
}

/** 片段是否适用于某个语言（`language` 或 scope 列表，`*` 为全部） */
export function snippetMatchesLanguage(snippet: ExtensionSnippet, language: string): boolean {
  if (snippet.language === '*') return true
  return snippet.language
    .split(',')
    .map((item) => item.trim())
    .includes(language)
}
