import type { ToolExecutionOutcome } from '../../shared/agent'
import type { PlanStore } from '../agent/planStore'
import type { UpdatePlanArgs } from './toolSchemas'

/**
 * update_plan：把模型提交的全量计划写入 PlanStore。
 * 存储层已做结构校验，这里只负责落库并生成确认文本。
 */
export async function runUpdatePlan(
  planStore: PlanStore,
  sessionId: string,
  args: UpdatePlanArgs
): Promise<ToolExecutionOutcome> {
  planStore.set(sessionId, args.plan)
  const done = args.plan.filter((item) => item.status === 'done').length
  const doing = args.plan.filter((item) => item.status === 'doing').length
  return {
    ok: true,
    content: `计划已更新（共 ${args.plan.length} 步：${done} 完成、${doing} 进行中、${args.plan.length - done - doing} 待办）：
${args.plan.map((item) => `- [${item.status}] ${item.step}`).join('\n')}`,
    summary: `计划 ${args.plan.length} 步（${done} 完成）`
  }
}
