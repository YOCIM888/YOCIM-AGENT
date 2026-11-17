/** 项目约定：按 projectId 独立保存的 Markdown 说明。 */

/** Mock Provider 用这个标记返回稳定的 Markdown 草稿，便于离线演示与 e2e。 */
export const CONVENTION_GENERATE_MARKER = '[YOCIM_CONVENTIONS_GENERATE]'

export type ConventionSource = 'manual' | 'ai'

export interface ProjectConvention {
  projectId: string
  content: string
  source: ConventionSource
  updatedAt: number
  /** 最近一次写入方：manual 为用户，ai 为确认后的 AI 草稿 */
  updatedBy: string
}
