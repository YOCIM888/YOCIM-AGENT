/**
 * 审批决定：
 * - approve / deny：本次操作；
 * - approve_session / approve_project：本次 + 记住允许规则（T4.2），
 *   规则只跳过后续同类人工审批，白名单与危险正则拦截不可被规则绕过。
 */
export type ApprovalDecision = 'approve' | 'approve_session' | 'approve_project' | 'deny'

/** diff 预览行：审批卡内着色展示 */
export interface DiffPreviewLine {
  type: 'add' | 'del' | 'ctx'
  text: string
}

export interface DiffPreviewHunk {
  header: string
  lines: DiffPreviewLine[]
}

/** 审批时随请求携带的 diff 预览（T4.1/T4.3） */
export interface ApprovalDiff {
  relativePath: string
  isNew: boolean
  hunks: DiffPreviewHunk[]
  truncated?: boolean
  /** 请求审批时的内容 hash：执行前再校验文件未被外部修改（T4.4） */
  contentHash?: string
}

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
  /** 写工具（write_file/edit_file）审批时携带的 diff 预览 */
  diff?: ApprovalDiff
  /** 是否展示「会话内允许 / 项目内允许」按钮（写文件与命令） */
  canAllowAlways?: boolean
}
