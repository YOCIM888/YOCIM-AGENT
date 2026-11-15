export type ApprovalDecision = 'approve' | 'deny'

/**
 * 审批模式：
 * - manual：写文件与命令都需要审批；
 * - auto：自动批准写文件，命令仍需要审批；
 * - open：自动批准所有工具操作（仍受路径守卫与命令白名单限制）。
 */
export type ApprovalMode = 'manual' | 'auto' | 'open'

export interface ApprovalRequest {
  approvalId: string
  callId: string
  tool: string
  risk: 'medium' | 'high'
  argsSummary: string
}
