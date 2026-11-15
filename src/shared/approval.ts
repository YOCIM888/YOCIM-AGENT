export type ApprovalDecision = 'approve' | 'deny'

export interface ApprovalRequest {
  approvalId: string
  callId: string
  tool: string
  risk: 'medium' | 'high'
  argsSummary: string
}
