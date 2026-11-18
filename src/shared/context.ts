/**
 * 上下文窗口与用量估算（主进程与渲染层共用）。
 *
 * 估算刻意保持"够用就好"：不做真实分词，但要对中英混排足够准，
 * 因为用量圆环、自动压缩阈值都依赖它。
 */

export const CONTEXT_WINDOW_MIN = 200_000
export const CONTEXT_WINDOW_MAX = 1_000_000
export const CONTEXT_WINDOW_DEFAULT = 200_000

/** 模型选择界面里可选的窗口档位 */
export const CONTEXT_WINDOW_OPTIONS = [200_000, 300_000, 400_000, 600_000, 800_000, 1_000_000]

/** 超过该比例自动压缩 */
export const CONTEXT_AUTO_COMPACT_RATIO = 0.8
/** 超过该比例强制压缩（压缩后仍超则硬裁剪） */
export const CONTEXT_HARD_COMPACT_RATIO = 0.95
/** 压缩后保留的最近条目数（按条，不是按 token） */
export const CONTEXT_KEEP_RECENT_ENTRIES = 8

const CJK_PATTERN = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g
const MESSAGE_OVERHEAD_TOKENS = 4

export function clampContextWindow(value: number): number {
  if (!Number.isFinite(value)) return CONTEXT_WINDOW_DEFAULT
  return Math.min(CONTEXT_WINDOW_MAX, Math.max(CONTEXT_WINDOW_MIN, Math.round(value)))
}

/**
 * 粗略 token 估算：CJK 字符按 1 token/字，其余按 4 字符/token。
 * 对代码与英文偏保守（宁可多估，提前触发压缩）。
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(CJK_PATTERN)?.length ?? 0
  const rest = text.length - cjk
  return cjk + Math.ceil(rest / 4)
}

/**
 * 按条累加估算，并计入每条消息的固定开销（role/分隔符等）。
 * assistant 的工具调用参数存在 toolCallsJson 里，content 可能为空，
 * 不算进来会系统性低估工具密集会话的用量，导致自动压缩触发偏晚。
 */
export function estimateMessagesTokens(
  messages: Array<{ content: string; toolCallsJson?: string | null }>
): number {
  let total = 0
  for (const message of messages) {
    total += estimateTextTokens(message.content)
    if (message.toolCallsJson) total += estimateTextTokens(message.toolCallsJson)
    total += MESSAGE_OVERHEAD_TOKENS
  }
  return total
}

export interface ContextUsage {
  /** 估算已用 token */
  used: number
  /** 当前模型窗口 */
  limit: number
  /** 0-1 */
  percent: number
  /** 参与上下文的条目数 */
  entries: number
  /** 已生成的压缩摘要条目数（通常 0 或 1） */
  summaries: number
  /** 最近一次压缩时间 */
  compactedAt: number | null
}

/**
 * 渲染层知道、主进程不知道的"当前处境"：正在看哪个文件、选中哪几行、哪些文件未保存。
 * 每轮随请求带上，注入 system prompt，模型不必再问"你现在打开的是哪个文件"。
 */
export interface ContextHint {
  activeFile?: string
  selection?: { startLine: number; endLine: number }
  dirtyFiles?: string[]
}

export function emptyUsage(limit = CONTEXT_WINDOW_DEFAULT): ContextUsage {
  return { used: 0, limit, percent: 0, entries: 0, summaries: 0, compactedAt: null }
}

export function usagePercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(1, Math.max(0, used / limit))
}

/** 压缩档位提示：圆环颜色与文案共用，避免两处阈值漂移 */
export function usageTone(percent: number): 'low' | 'medium' | 'high' {
  if (percent >= CONTEXT_AUTO_COMPACT_RATIO) return 'high'
  if (percent >= 0.5) return 'medium'
  return 'low'
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

export function formatWindowSize(tokens: number): string {
  return `${Math.round(tokens / 1000)}K`
}
