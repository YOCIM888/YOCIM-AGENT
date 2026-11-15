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
  /** 工具调用 ID（P3 起记录，历史条目为空） */
  callId?: string
  /** 工具执行耗时（毫秒，P3 起记录） */
  durationMs?: number
}

/** 审计查询条件；未提供的字段表示不过滤 */
export interface AuditFilter {
  sessionId?: string
  tool?: string
  ok?: boolean
  approval?: AuditApproval
  /** 匹配工具名 / 参数摘要 / 结果摘要 */
  keyword?: string
  /** 起始时间（含） */
  from?: number
  /** 结束时间（含） */
  to?: number
}

export interface AuditPage {
  entries: AuditEntry[]
  total: number
  page: number
  pageSize: number
}

export interface AuditStats {
  total: number
  ok: number
  failed: number
  approved: number
  denied: number
  notRequired: number
  firstTs: number | null
  lastTs: number | null
  /** 当前筛选结果中出现过的工具名，用于筛选下拉 */
  tools: string[]
}

export type AuditExportFormat = 'json' | 'csv'

export interface AuditExportResult {
  path: string | null
  count: number
}
