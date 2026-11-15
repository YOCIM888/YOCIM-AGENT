import type { AuditEntry } from '../../shared/audit'

const APPROVAL_LABEL: Record<AuditEntry['approval'], string> = {
  not_required: '免审批',
  approved: '已批准',
  denied: '已拒绝'
}

export function approvalLabel(value: AuditEntry['approval']): string {
  return APPROVAL_LABEL[value]
}

export function auditToJson(entries: AuditEntry[]): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    count: entries.length,
    entries: entries.map((entry) => ({
      ...entry,
      time: new Date(entry.ts).toISOString(),
      approvalLabel: approvalLabel(entry.approval)
    }))
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

function csvCell(value: string | number | undefined): string {
  if (value === undefined || value === null) return ''
  const text = String(value).replace(/\r\n/g, '\n')
  // 防止表格公式注入：以 = + - @ 开头的单元格前置单引号
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${guarded.replace(/"/g, '""')}"`
}

export function auditToCsv(entries: AuditEntry[]): string {
  const header = [
    '时间',
    '工具',
    '结果',
    '审批',
    '会话',
    'runId',
    'callId',
    '耗时(ms)',
    '参数摘要',
    '结果摘要'
  ]
  const lines = [header.map((cell) => csvCell(cell)).join(',')]
  for (const entry of entries) {
    lines.push(
      [
        new Date(entry.ts).toISOString(),
        entry.tool,
        entry.ok ? '成功' : '失败',
        approvalLabel(entry.approval),
        entry.sessionId,
        entry.runId,
        entry.callId ?? '',
        entry.durationMs ?? '',
        entry.argsSummary,
        entry.resultSummary
      ]
        .map((cell) => csvCell(cell))
        .join(',')
    )
  }
  // BOM 让 Excel 正确识别 UTF-8 中文
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
