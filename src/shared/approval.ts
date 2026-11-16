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
 * 审批模式（按风险分层，见 main/tools/commandRisk.ts）：
 * - manual：只读以外的一切改动都需要审批；
 * - auto：本地可逆改动自动批准，外部可见或有损操作仍需审批（默认）；
 * - open：自动批准除危险正则命中的所有工具操作，git 子命令全部放行。
 * 三档都受路径守卫、命令白名单与危险正则限制。
 */
export type ApprovalMode = 'manual' | 'auto' | 'open'

export interface ApprovalRequest {
  approvalId: string
  callId: string
  tool: string
  risk: 'medium' | 'high'
  argsSummary: string
  /** 「为什么需要确认」的简短说明，审批卡展示 */
  reason?: string
  /** 写工具（write_file/edit_file）审批时携带的 diff 预览 */
  diff?: ApprovalDiff
  /** 是否展示「会话内允许 / 项目内允许」按钮（写文件与命令） */
  canAllowAlways?: boolean
}
