import { randomUUID } from 'node:crypto'
import type { ApprovalDecision, ApprovalRequest } from '../../shared/approval'

interface PendingApproval {
  resolve: (approved: boolean) => void
}

/**
 * 审批队列：一次请求对应一个 approvalId，只接受首个应答；
 * run 被取消时自动按“拒绝”处理，未决审批不会被执行。
 */
export class ApprovalManager {
  private readonly pending = new Map<string, PendingApproval>()

  constructor(private readonly emit: (request: ApprovalRequest) => void) {}

  request(details: Omit<ApprovalRequest, 'approvalId'>, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false)

    const approvalId = randomUUID()
    return new Promise<boolean>((resolve) => {
      const onAbort = (): void => {
        this.pending.delete(approvalId)
        resolve(false)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(approvalId, {
        resolve: (approved) => {
          signal.removeEventListener('abort', onAbort)
          resolve(approved)
        }
      })
      this.emit({ approvalId, ...details })
    })
  }

  respond(approvalId: string, decision: ApprovalDecision): boolean {
    const pending = this.pending.get(approvalId)
    if (!pending) return false
    this.pending.delete(approvalId)
    pending.resolve(decision === 'approve')
    return true
  }

  pendingCount(): number {
    return this.pending.size
  }
}
