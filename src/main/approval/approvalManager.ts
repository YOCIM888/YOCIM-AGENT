import { randomUUID } from 'node:crypto'
import type { ApprovalDecision, ApprovalRequest } from '../../shared/approval'

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void
}

/**
 * 审批队列：一次请求对应一个 approvalId，只接受首个应答；
 * run 被取消时自动按“拒绝”处理，未决审批不会被执行。
 * approve_session / approve_project 由调用方（ToolService）消费：
 * 这里只负责把决定原样交回。
 */
export class ApprovalManager {
  private readonly pending = new Map<string, PendingApproval>()

  constructor(private readonly emit: (request: ApprovalRequest) => void) {}

  request(
    details: Omit<ApprovalRequest, 'approvalId'>,
    signal: AbortSignal
  ): Promise<ApprovalDecision> {
    if (signal.aborted) return Promise.resolve('deny')

    const approvalId = randomUUID()
    return new Promise<ApprovalDecision>((resolve) => {
      const onAbort = (): void => {
        this.pending.delete(approvalId)
        resolve('deny')
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(approvalId, {
        resolve: (decision) => {
          signal.removeEventListener('abort', onAbort)
          resolve(decision)
        }
      })
      this.emit({ approvalId, ...details })
    })
  }

  respond(approvalId: string, decision: ApprovalDecision): boolean {
    const pending = this.pending.get(approvalId)
    if (!pending) return false
    this.pending.delete(approvalId)
    pending.resolve(decision)
    return true
  }

  pendingCount(): number {
    return this.pending.size
  }
}
