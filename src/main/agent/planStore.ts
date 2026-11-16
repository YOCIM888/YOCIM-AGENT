import type { PlanItem } from '../../shared/agent'
import type { AgentPlanRepository } from '../db/repositories'

function isValidPlan(value: unknown): value is PlanItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return false
  return value.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof (item as PlanItem).step === 'string' &&
      ((item as PlanItem).step as string).trim().length > 0 &&
      ((item as PlanItem).status === 'pending' ||
        (item as PlanItem).status === 'doing' ||
        (item as PlanItem).status === 'done')
  )
}

export interface PlanStoreDeps {
  repo: AgentPlanRepository
  /** 计划变更回调（用于向渲染层广播 plan:updated） */
  onChange?: (sessionId: string, plan: PlanItem[]) => void
}

/**
 * 会话级计划状态：工具写入与 Agent 循环读取共用同一实例，
 * 内存缓存避免每轮都查 DB。
 */
export class PlanStore {
  private readonly cache = new Map<string, PlanItem[]>()

  constructor(private readonly deps: PlanStoreDeps) {}

  get(sessionId: string): PlanItem[] {
    const cached = this.cache.get(sessionId)
    if (cached) return cached
    const stored = this.deps.repo.get(sessionId)
    if (!stored || !isValidPlan(stored.plan)) return []
    const plan = stored.plan as PlanItem[]
    this.cache.set(sessionId, plan)
    return plan
  }

  set(sessionId: string, plan: PlanItem[]): PlanItem[] {
    this.cache.set(sessionId, plan)
    this.deps.repo.set(sessionId, plan)
    this.deps.onChange?.(sessionId, plan)
    return plan
  }

  clear(sessionId: string): void {
    this.cache.delete(sessionId)
    this.deps.repo.clear(sessionId)
  }

  /** 计划的一段紧凑文本，注入 system prompt（无计划返回 null） */
  renderForPrompt(sessionId: string): string | null {
    const plan = this.get(sessionId)
    if (!plan.length) return null
    const mark = (status: PlanItem['status']): string =>
      status === 'done' ? '[x]' : status === 'doing' ? '[~]' : '[ ]'
    const lines = plan.map((item) => `${mark(item.status)} ${item.step}`)
    return lines.join('\n')
  }
}
