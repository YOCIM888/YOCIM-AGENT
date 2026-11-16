import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** 项目规则注入上限：超出直接截断，避免规则文件本身把窗口吃满 */
export const RULES_LIMIT_CHARS = 8000

const RULE_FILES = ['AGENTS.md', '.yocim/rules.md'] as const

export interface WorkspaceRules {
  content: string
  sources: string[]
}

/**
 * 读取项目规则：AGENTS.md 优先，其次 .yocim/rules.md，按顺序拼接。
 * 任一文件缺失都静默跳过——规则是可选的，不能因为它阻塞对话。
 */
export async function loadWorkspaceRules(
  root: string | null | undefined
): Promise<WorkspaceRules | null> {
  if (!root) return null
  const parts: string[] = []
  const sources: string[] = []
  let total = 0

  for (const name of RULE_FILES) {
    if (total >= RULES_LIMIT_CHARS) break
    let raw: string
    try {
      raw = await readFile(path.join(root, name), 'utf8')
    } catch {
      continue
    }
    const text = raw.trim()
    if (!text) continue
    const allowed = RULES_LIMIT_CHARS - total
    const clipped =
      text.length > allowed ? `${text.slice(0, allowed)}\n[规则文件过长，已截断]` : text
    parts.push(clipped)
    sources.push(name)
    total += clipped.length
  }

  if (!parts.length) return null
  return { content: parts.join('\n\n---\n\n'), sources }
}
