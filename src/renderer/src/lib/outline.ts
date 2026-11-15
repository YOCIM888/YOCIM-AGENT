export type OutlineKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'function'
  | 'method'
  | 'variable'
  | 'heading'
  | 'key'
  | 'selector'

export interface OutlineSymbol {
  name: string
  kind: OutlineKind
  line: number
  depth: number
}

const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'do',
  'else',
  'try',
  'case',
  'function',
  'new',
  'typeof',
  'await',
  'yield'
])

function indentDepth(line: string): number {
  const match = /^[\t ]*/.exec(line)
  const raw = match ? match[0] : ''
  const columns = raw.replace(/\t/g, '  ').length
  return Math.min(6, Math.floor(columns / 2))
}

function extractScript(content: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = []
  const lines = content.split(/\r?\n/)
  const patterns: Array<{ kind: OutlineKind; regex: RegExp }> = [
    {
      kind: 'class',
      regex: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/
    },
    { kind: 'interface', regex: /^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/ },
    { kind: 'type', regex: /^(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/ },
    { kind: 'enum', regex: /^(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z0-9_$]+)/ },
    {
      kind: 'function',
      regex: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/
    },
    { kind: 'variable', regex: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)/ }
  ]
  const methodRegex =
    /^(?:(?:public|private|protected|static|async|readonly|get|set|override)\s+)*([A-Za-z0-9_$]+)\s*\([^)]*\)\s*(?::[^{;]+)?\{/

  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return
    const depth = indentDepth(raw)
    for (const { kind, regex } of patterns) {
      const match = regex.exec(line)
      if (match) {
        symbols.push({ name: match[1], kind, line: index + 1, depth })
        return
      }
    }
    if (depth > 0) {
      const match = methodRegex.exec(line)
      if (match && !KEYWORDS.has(match[1])) {
        symbols.push({ name: match[1], kind: 'method', line: index + 1, depth })
      }
    }
  })
  return symbols
}

function extractMarkdown(content: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = []
  const lines = content.split(/\r?\n/)
  let inFence = false
  lines.forEach((raw, index) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw)
    if (match) {
      symbols.push({
        name: match[2],
        kind: 'heading',
        line: index + 1,
        depth: match[1].length - 1
      })
    }
  })
  return symbols
}

function extractJson(content: string): OutlineSymbol[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const lines = content.split(/\r?\n/)
  const symbols: OutlineSymbol[] = []
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`"${escaped}"\\s*:`)
    const lineIndex = lines.findIndex((line) => regex.test(line))
    symbols.push({ name: key, kind: 'key', line: lineIndex >= 0 ? lineIndex + 1 : 1, depth: 0 })
  }
  return symbols
}

function extractCss(content: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = []
  const lines = content.split(/\r?\n/)
  let inComment = false
  lines.forEach((raw, index) => {
    let line = raw
    if (inComment) {
      const end = line.indexOf('*/')
      if (end < 0) return
      line = line.slice(end + 2)
      inComment = false
    }
    const start = line.indexOf('/*')
    if (start >= 0) {
      const end = line.indexOf('*/', start + 2)
      if (end < 0) {
        inComment = true
        line = line.slice(0, start)
      } else {
        line = line.slice(0, start) + line.slice(end + 2)
      }
    }
    const match = /^\s*([^{}@/][^{}]*?)\s*\{/.exec(line)
    if (match) {
      const selector = match[1].trim()
      if (selector) {
        symbols.push({ name: selector, kind: 'selector', line: index + 1, depth: indentDepth(raw) })
      }
    }
  })
  return symbols
}

function extractGeneric(content: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = []
  const lines = content.split(/\r?\n/)
  const regex =
    /^\s*(?:pub\s+|public\s+|private\s+|static\s+|async\s+|export\s+)*(?:def|fn|func|function|sub|class|struct|interface|module)\s+([A-Za-z0-9_$]+)/
  lines.forEach((raw, index) => {
    const match = regex.exec(raw)
    if (match) {
      const kind: OutlineKind = /class|struct|interface|module/.test(match[0])
        ? 'class'
        : 'function'
      symbols.push({ name: match[1], kind, line: index + 1, depth: indentDepth(raw) })
    }
  })
  return symbols
}

export function extractOutline(content: string, language: string): OutlineSymbol[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return extractScript(content)
    case 'markdown':
      return extractMarkdown(content)
    case 'json':
      return extractJson(content)
    case 'css':
    case 'scss':
    case 'less':
      return extractCss(content)
    default:
      return extractGeneric(content)
  }
}
