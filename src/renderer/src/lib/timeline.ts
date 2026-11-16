import type { AgentStep } from './agentSteps'

/**
 * 时间线（工具活动流）的展示辅助函数。
 *
 * 纯函数放在这里，方便单测直接覆盖，不必启动 Vue 组件。
 */

/** 工具图标分类：决定时间线里用哪个图标。 */
export type ToolIconKey =
  'read' | 'write' | 'edit' | 'folder' | 'search' | 'terminal' | 'plan' | 'git' | 'image'

const TOOL_ICON_MAP: Record<string, ToolIconKey> = {
  read_file: 'read',
  write_file: 'write',
  edit_file: 'edit',
  list_dir: 'folder',
  search_files: 'search',
  run_command: 'terminal',
  run_tests: 'terminal',
  run_typecheck: 'terminal',
  run_lint: 'terminal',
  update_plan: 'plan',
  get_git_diff: 'git',
  generate_image: 'image'
}

/** 按工具名取图标分类；未知工具回落到终端图标。 */
export function toolIconKey(name: string): ToolIconKey {
  return TOOL_ICON_MAP[name] ?? 'terminal'
}

/**
 * 拆出参数摘要里除工具名以外的部分。
 *
 * 参数摘要形如 `read_file src/index.ts`、`search_files「TODO」 @src`，
 * 时间线上工具名单独一列，剩余部分作为可读详情展示。
 */
export function toolDetail(name: string, argsSummary: string): string {
  const summary = argsSummary.trim()
  if (!summary) return ''
  if (!summary.startsWith(name)) return summary
  return summary.slice(name.length).trim()
}

/** 毫秒 → 人类可读时长（`820ms` / `3.4s` / `1m 05s`）。 */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.round(ms))
  if (safe < 1000) return `${safe}ms`
  const seconds = safe / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${String(rest).padStart(2, '0')}s`
}

/** 单步耗时；未结束返回空串。 */
export function stepDuration(step: AgentStep): string {
  if (!step.endedAt) return ''
  return formatDuration(step.endedAt - step.startedAt)
}

/** 步骤状态文案。 */
export function stepStatusLabel(step: AgentStep): string {
  if (step.status === 'running') return '执行中'
  if (step.status === 'done') return '完成'
  return '失败'
}

/** 审批状态文案。 */
export function approvalStatusLabel(status: 'pending' | 'approved' | 'denied'): string {
  if (status === 'approved') return '已批准'
  if (status === 'denied') return '已拒绝'
  return '待审批'
}
