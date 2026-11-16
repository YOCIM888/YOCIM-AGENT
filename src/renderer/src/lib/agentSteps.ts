import type { ApprovalDecision } from '@shared/approval'

export type ToolStepStatus = 'running' | 'done' | 'failed'
export type ApprovalStatus = 'pending' | 'approved' | 'denied'

export interface StepApproval {
  approvalId: string
  risk: 'medium' | 'high'
  status: ApprovalStatus
}

export interface AgentStep {
  id: string
  callId: string
  name: string
  argsSummary: string
  status: ToolStepStatus
  startedAt: number
  endedAt?: number
  summary?: string
  approval?: StepApproval
  /** 命令等长任务的增量输出（tool:output 事件追加，保留尾部） */
  output?: string
  /** 生图等工具产出的图片 URL，供时间线渲染缩略图 */
  images?: string[]
}

/** 单步输出在 UI 里保留的最大长度：只展示尾部，避免长时间运行撑爆内存 */
const STEP_OUTPUT_MAX_CHARS = 8000

export function appendStepOutput(step: AgentStep, text: string): AgentStep {
  const merged = `${step.output ?? ''}${text}`
  step.output =
    merged.length > STEP_OUTPUT_MAX_CHARS ? merged.slice(-STEP_OUTPUT_MAX_CHARS) : merged
  return step
}

export interface ToolStepInput {
  callId: string
  name: string
  argsSummary: string
  startedAt: number
}

let stepSeq = 0

function nextStepId(): string {
  stepSeq += 1
  return `step-${Date.now().toString(36)}-${stepSeq}`
}

export function createToolStep(input: ToolStepInput): AgentStep {
  return {
    id: nextStepId(),
    callId: input.callId,
    name: input.name,
    argsSummary: input.argsSummary,
    status: 'running',
    startedAt: input.startedAt
  }
}

/** 同一个 callId 只保留一个步骤，避免重复事件造成时间线重复。 */
export function upsertToolStep(steps: AgentStep[], input: ToolStepInput): AgentStep {
  const existing = steps.find((step) => step.callId === input.callId)
  if (existing) return existing
  const step = createToolStep(input)
  steps.push(step)
  return step
}

export function resolveToolStep(
  steps: AgentStep[],
  callId: string,
  outcome: { ok: boolean; summary: string; endedAt: number; images?: string[] }
): AgentStep | null {
  const step = steps.find((item) => item.callId === callId)
  if (!step) return null
  step.status = outcome.ok ? 'done' : 'failed'
  step.summary = outcome.summary
  step.endedAt = outcome.endedAt
  if (outcome.images?.length) step.images = outcome.images
  return step
}

export function attachStepApproval(
  steps: AgentStep[],
  request: { approvalId: string; callId: string; risk: 'medium' | 'high' }
): AgentStep | null {
  const step = steps.find((item) => item.callId === request.callId)
  if (!step) return null
  step.approval = {
    approvalId: request.approvalId,
    risk: request.risk,
    status: 'pending'
  }
  return step
}

export function resolveStepApproval(
  steps: AgentStep[],
  approvalId: string,
  decision: ApprovalDecision
): AgentStep | null {
  const step = steps.find((item) => item.approval?.approvalId === approvalId)
  if (!step?.approval) return null
  step.approval.status = decision === 'approve' ? 'approved' : 'denied'
  return step
}

/** run 结束时未决审批按拒绝处理（与主进程取消语义一致）。 */
export function closePendingApprovals(steps: AgentStep[]): void {
  for (const step of steps) {
    if (step.approval?.status === 'pending') {
      step.approval.status = 'denied'
    }
  }
}

export function settleRunningSteps(steps: AgentStep[], summary: string, endedAt: number): void {
  for (const step of steps) {
    if (step.status !== 'running') continue
    step.status = 'failed'
    step.summary = summary
    step.endedAt = endedAt
  }
}

export function hasPendingApproval(steps: AgentStep[]): boolean {
  return steps.some((step) => step.approval?.status === 'pending')
}
