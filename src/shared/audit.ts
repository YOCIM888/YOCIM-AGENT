export type AuditApproval = 'not_required' | 'approved' | 'denied'

export interface AuditEntry {
  id: string
  ts: number
  sessionId: string
  runId: string
  tool: string
  argsSummary: string
  resultSummary: string
  approval: AuditApproval
  ok: boolean
}
