import { randomUUID } from 'node:crypto'
import type { SettingsRepository } from '../db/repositories'

/**
 * 会话级 / 项目级允许规则（T4.2）：
 * - command 规则：放行以该前缀开头的命令（跳过人工审批）；
 * - path 规则：放行该目录/文件前缀下的写操作；
 * - session 规则存内存（随进程结束消失），project 规则持久化到 settings 键值存储；
 * - 规则只解决「跳过人工审批」：白名单与危险正则拦截始终先执行，不可被规则绕过。
 */

export type AllowRuleKind = 'command' | 'path'
export type AllowRuleScope = 'session' | 'project'

export interface AllowRule {
  id: string
  kind: AllowRuleKind
  /** command：完整命令前缀；path：相对路径目录或文件 */
  value: string
  scope: AllowRuleScope
  /** session 规则所属会话 */
  sessionId?: string
  /** 规则名：审计记录用，如「会话命令 npm test」「项目路径 docs/**」 */
  name: string
  createdAt: number
}

interface StoredAllowRule {
  id: string
  kind: AllowRuleKind
  value: string
  name: string
  createdAt: number
}

const RULE_KEY_PREFIX = 'allowRules:'
const MAX_RULES_PER_PROJECT = 100

function normalizeCommand(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

export interface AddAllowRuleInput {
  kind: AllowRuleKind
  value: string
  scope: AllowRuleScope
  sessionId?: string
  /** 展示名（未提供时自动生成） */
  label?: string
}

export class AllowRuleStore {
  private readonly sessionRules = new Map<string, AllowRule[]>()

  constructor(private readonly settings?: SettingsRepository | null) {}

  add(input: AddAllowRuleInput, workspaceRoot: string): AllowRule {
    const value =
      input.kind === 'command' ? normalizeCommand(input.value) : normalizePath(input.value)
    if (!value) throw new Error('允许规则内容不能为空')
    const scopeLabel = input.scope === 'session' ? '会话' : '项目'
    const kindLabel = input.kind === 'command' ? '命令' : '路径'
    const rule: AllowRule = {
      id: randomUUID(),
      kind: input.kind,
      value,
      scope: input.scope,
      sessionId: input.scope === 'session' ? input.sessionId : undefined,
      name:
        input.label?.trim() ||
        `${scopeLabel}${kindLabel} ${input.kind === 'command' ? value : `${value}/**`}`,
      createdAt: Date.now()
    }

    if (input.scope === 'session') {
      const sessionId = input.sessionId
      if (!sessionId) throw new Error('会话级规则需要 sessionId')
      const rules = this.sessionRules.get(sessionId) ?? []
      rules.push(rule)
      this.sessionRules.set(sessionId, rules)
      return rule
    }

    this.saveProjectRule(workspaceRoot, rule)
    return rule
  }

  /** 命中返回规则名（审计用），未命中返回 null */
  matchesCommand(workspaceRoot: string, sessionId: string | null, command: string): string | null {
    const normalized = normalizeCommand(command)
    for (const rule of this.allRules(workspaceRoot, sessionId)) {
      if (rule.kind !== 'command') continue
      if (normalized === rule.value || normalized.startsWith(`${rule.value} `)) {
        return rule.name
      }
    }
    return null
  }

  /** 命中返回规则名，未命中返回 null */
  matchesWritePath(
    workspaceRoot: string,
    sessionId: string | null,
    relativePath: string
  ): string | null {
    const normalized = normalizePath(relativePath)
    for (const rule of this.allRules(workspaceRoot, sessionId)) {
      if (rule.kind !== 'path') continue
      if (normalized === rule.value || normalized.startsWith(`${rule.value}/`)) {
        return rule.name
      }
    }
    return null
  }

  list(workspaceRoot: string, sessionId?: string | null): AllowRule[] {
    return this.allRules(workspaceRoot, sessionId ?? null)
  }

  clearSession(sessionId: string): void {
    this.sessionRules.delete(sessionId)
  }

  private allRules(workspaceRoot: string, sessionId: string | null): AllowRule[] {
    const session = sessionId ? (this.sessionRules.get(sessionId) ?? []) : []
    const project = this.loadProjectRules(workspaceRoot)
    return [...session, ...project]
  }

  private projectKey(workspaceRoot: string): string {
    return `${RULE_KEY_PREFIX}${workspaceRoot}`
  }

  private loadProjectRules(workspaceRoot: string): AllowRule[] {
    if (!this.settings) return []
    const raw = this.settings.get(this.projectKey(workspaceRoot))
    if (typeof raw !== 'string') return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter(
          (item): item is StoredAllowRule =>
            item &&
            typeof item === 'object' &&
            ((item as StoredAllowRule).kind === 'command' ||
              (item as StoredAllowRule).kind === 'path') &&
            typeof (item as StoredAllowRule).value === 'string'
        )
        .map((item) => ({
          ...item,
          scope: 'project' as const,
          sessionId: undefined
        }))
    } catch {
      return []
    }
  }

  private saveProjectRule(workspaceRoot: string, rule: AllowRule): void {
    if (!this.settings) return
    const existing = this.loadProjectRules(workspaceRoot)
    // 重复规则跳过
    if (existing.some((item) => item.kind === rule.kind && item.value === rule.value)) {
      return
    }
    const stored: StoredAllowRule[] = [
      ...existing,
      {
        id: rule.id,
        kind: rule.kind,
        value: rule.value,
        name: rule.name,
        createdAt: rule.createdAt
      }
    ].slice(-MAX_RULES_PER_PROJECT)
    this.settings.set(this.projectKey(workspaceRoot), JSON.stringify(stored))
  }
}
