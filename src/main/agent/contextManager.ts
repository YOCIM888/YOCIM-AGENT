import { randomUUID } from 'node:crypto'
import type { AgentMessage, ChatProvider } from '../../shared/agent'
import {
  CONTEXT_AUTO_COMPACT_RATIO,
  CONTEXT_HARD_COMPACT_RATIO,
  CONTEXT_KEEP_RECENT_ENTRIES,
  estimateMessagesTokens,
  estimateTextTokens,
  usagePercent,
  type ContextUsage
} from '../../shared/context'
import type { AgentContextEntry, AgentContextRepository } from '../db/repositories'

export interface ContextManagerDeps {
  repo: AgentContextRepository
  provider: () => ChatProvider
}

export interface CompactOutcome {
  compacted: boolean
  dropped: number
  /** 压缩前的条目 token 估算 */
  before: number
  /** 压缩后的条目 token 估算 */
  after: number
  summary: string
  reason: 'auto' | 'manual'
}

export interface AutoCompactOutcome extends CompactOutcome {
  /** 硬裁剪（直接丢弃最旧条目）删除的条数 */
  trimmed: number
  usage: ContextUsage
}

const COMPACT_TIMEOUT_MS = 60_000
const SUMMARY_MAX_CHARS = 6000
const ENTRY_TEXT_LIMIT: Record<AgentContextEntry['role'], number> = {
  user: 1500,
  assistant: 1500,
  tool: 700,
  summary: 2000
}

const PATH_PATTERN =
  /[\w./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|vue|json|md|py|go|rs|java|kt|css|scss|html|yml|yaml|toml|sql|sh|ps1)/g

export function buildTranscript(entries: AgentContextEntry[]): string {
  return entries
    .map((entry) => {
      const label =
        entry.role === 'summary'
          ? '旧摘要'
          : entry.role === 'tool'
            ? '工具结果'
            : entry.role === 'assistant'
              ? '助手'
              : '用户'
      const cap = ENTRY_TEXT_LIMIT[entry.role]
      const text =
        entry.content.length > cap ? `${entry.content.slice(0, cap)}…[已截断]` : entry.content
      return `[#${entry.seq} ${label}]\n${text}`
    })
    .join('\n\n')
}

/** Provider 失败/超时时的确定性回退：不求精彩，只求不丢关键事实 */
export function fallbackSummary(entries: AgentContextEntry[]): string {
  const users = entries
    .filter((entry) => entry.role === 'user')
    .slice(-5)
    .map((entry) => `- ${entry.content.replace(/\s+/g, ' ').slice(0, 140)}`)
  const paths = new Set<string>()
  for (const entry of entries) {
    for (const match of entry.content.match(PATH_PATTERN) ?? []) {
      if (paths.size >= 20) break
      paths.add(match.replace(/\\/g, '/'))
    }
  }
  const lastAssistant = [...entries]
    .reverse()
    .find((entry) => entry.role === 'assistant' && entry.content.trim())

  const lines: string[] = ['（自动生成的上下文压缩摘要）']
  if (users.length) lines.push('', '用户此前的请求：', ...users.map((line) => line))
  if (paths.size) lines.push('', '涉及的文件：', [...paths].map((p) => `- ${p}`).join('\n'))
  if (lastAssistant) {
    lines.push(
      '',
      '最近的助手输出（节选）：',
      lastAssistant.content.replace(/\s+/g, ' ').slice(0, 400)
    )
  }
  return lines.join('\n').slice(0, SUMMARY_MAX_CHARS)
}

const COMPACTION_PROMPT = (transcript: string): string =>
  [
    '以下是编码助手对话的早期内容。请把它压缩成不超过 600 字的结构化摘要，必须保留：',
    '1) 用户目标与当前进度；2) 已读取/修改的文件路径与关键改动；3) 重要的结论、约束与用户偏好；4) 未完成事项与下一步。',
    '只输出摘要正文，不要解释，不要使用 markdown 标题。',
    '',
    '<transcript>',
    transcript,
    '</transcript>'
  ].join('\n')

async function collectText(
  provider: ChatProvider,
  prompt: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let text = ''
    for await (const chunk of provider.stream(
      { messages: [{ role: 'user', content: prompt }] },
      controller.signal
    )) {
      if (chunk.type === 'text') text += chunk.text
      if (chunk.type === 'done') break
    }
    return text.trim()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 上下文管理器：模型侧对话流的唯一写入方。
 *
 * 职责：条目 ↔ AgentMessage 的互转、用量估算、LLM 压缩（带回退）、超窗硬裁剪。
 * 它不关心 UI——messages 表里的聊天记录始终完整，压缩只影响发给模型的内容。
 */
export class ContextManager {
  constructor(private readonly deps: ContextManagerDeps) {}

  entries(sessionId: string): AgentContextEntry[] {
    return this.deps.repo.list(sessionId)
  }

  toMessages(entries: AgentContextEntry[]): AgentMessage[] {
    const messages: AgentMessage[] = []
    // 兜底：历史遗留数据或压缩留下的残片里，tool 结果可能与前置 assistant 拆散。
    // Provider 对「孤立 tool 结果」「toolCalls 没有结果」都会返回 400，这里统一裁掉。
    for (const entry of sanitizeToolPairs(entries)) {
      if (entry.role === 'summary') {
        messages.push({
          role: 'system',
          content: `以下是此前对话的压缩摘要，作为背景信息：\n\n${entry.content}`
        })
        continue
      }
      if (entry.role === 'tool') {
        messages.push({
          role: 'tool',
          content: entry.content,
          toolCallId: entry.toolCallId ?? undefined
        })
        continue
      }
      if (entry.role === 'assistant') {
        const toolCalls = parseToolCalls(entry.toolCallsJson)
        const reasoning = entry.reasoningContent ? { reasoningContent: entry.reasoningContent } : {}
        const signature = entry.reasoningSignature
          ? { reasoningSignature: entry.reasoningSignature }
          : {}
        if (toolCalls.length) {
          messages.push({
            role: 'assistant',
            content: entry.content,
            toolCalls,
            ...reasoning,
            ...signature
          })
        } else {
          messages.push({ role: 'assistant', content: entry.content, ...reasoning, ...signature })
        }
        continue
      }
      messages.push({ role: 'user', content: entry.content })
    }
    return messages
  }

  appendMessage(sessionId: string, message: AgentMessage): AgentContextEntry {
    const role: AgentContextEntry['role'] =
      message.role === 'tool' ? 'tool' : message.role === 'assistant' ? 'assistant' : 'user'
    return this.deps.repo.append({
      id: randomUUID(),
      sessionId,
      role,
      content: message.content,
      toolCallsJson: message.toolCalls?.length ? JSON.stringify(message.toolCalls) : null,
      toolCallId: message.toolCallId ?? null,
      reasoningContent: message.reasoningContent ?? null,
      reasoningSignature: message.reasoningSignature ?? null,
      tokens: estimateTextTokens(message.content),
      createdAt: Date.now()
    })
  }

  /** 旧会话迁移：上下文存储为空时，用 renderer 传来的纯文本历史垫底 */
  seedFromHistory(sessionId: string, history: AgentMessage[]): void {
    const stats = this.deps.repo.countBySession(sessionId)
    if (stats.entries > 0) return
    for (const message of history) {
      if (message.role !== 'user' && message.role !== 'assistant') continue
      this.appendMessage(sessionId, { role: message.role, content: message.content })
    }
  }

  usage(sessionId: string, systemTokens: number, limit: number): ContextUsage {
    const entries = this.deps.repo.list(sessionId)
    return this.usageFromEntries(entries, systemTokens, limit, sessionId)
  }

  private usageFromEntries(
    entries: AgentContextEntry[],
    systemTokens: number,
    limit: number,
    sessionId: string
  ): ContextUsage {
    const used = systemTokens + estimateMessagesTokens(entries)
    const stats = this.deps.repo.countBySession(sessionId)
    return {
      used,
      limit,
      percent: usagePercent(used, limit),
      entries: stats.entries,
      summaries: stats.summaries,
      compactedAt: this.deps.repo.latestSummaryAt(sessionId)
    }
  }

  /**
   * 按需压缩：超过自动阈值时把最旧的条目换成一条摘要。
   * 压缩后仍超过硬阈值则继续丢弃最旧条目（不生成摘要）。
   */
  async maybeAutoCompact(
    sessionId: string,
    options: { systemTokens: number; limit: number }
  ): Promise<AutoCompactOutcome> {
    const entries = this.deps.repo.list(sessionId)
    const before = this.usageFromEntries(entries, options.systemTokens, options.limit, sessionId)
    if (before.percent < CONTEXT_AUTO_COMPACT_RATIO) {
      return {
        compacted: false,
        dropped: 0,
        trimmed: 0,
        before: before.used,
        after: before.used,
        summary: '',
        reason: 'auto',
        usage: before
      }
    }

    const outcome = await this.compact(sessionId, {
      reason: 'auto',
      systemTokens: options.systemTokens
    })
    let trimmed = 0
    const afterEntries = this.deps.repo.list(sessionId)
    const afterUsage = this.usageFromEntries(
      afterEntries,
      options.systemTokens,
      options.limit,
      sessionId
    )
    if (afterUsage.percent >= CONTEXT_HARD_COMPACT_RATIO) {
      trimmed = this.hardTrim(sessionId, {
        systemTokens: options.systemTokens,
        limit: options.limit,
        targetRatio: CONTEXT_AUTO_COMPACT_RATIO
      })
    }
    const usage = this.usage(sessionId, options.systemTokens, options.limit)
    return {
      ...outcome,
      trimmed,
      usage
    }
  }

  /** 手动压缩：保留更少的近期条目，让用户能主动腾出空间 */
  async compactManually(
    sessionId: string,
    options: { systemTokens: number; limit: number }
  ): Promise<AutoCompactOutcome> {
    const outcome = await this.compact(sessionId, {
      reason: 'manual',
      keepRecent: 2,
      systemTokens: options.systemTokens
    })
    const usage = this.usage(sessionId, options.systemTokens, options.limit)
    return { ...outcome, trimmed: 0, usage }
  }

  async compact(
    sessionId: string,
    options: { reason: 'auto' | 'manual'; keepRecent?: number; systemTokens: number }
  ): Promise<CompactOutcome> {
    const entries = this.deps.repo.list(sessionId)
    const keepRecent = options.keepRecent ?? CONTEXT_KEEP_RECENT_ENTRIES
    if (entries.length <= keepRecent) {
      return {
        compacted: false,
        dropped: 0,
        before: estimateMessagesTokens(entries),
        after: estimateMessagesTokens(entries),
        summary: '',
        reason: options.reason
      }
    }

    const cut = alignCutToToolBoundary(entries, entries.length - keepRecent)
    const prefix = entries.slice(0, cut)
    const throughSeq = prefix[prefix.length - 1].seq
    const before = estimateMessagesTokens(entries)

    let summary = ''
    const prefixTokens = estimateMessagesTokens(prefix)
    try {
      const generated = await collectText(
        this.deps.provider(),
        COMPACTION_PROMPT(buildTranscript(prefix)),
        COMPACT_TIMEOUT_MS
      )
      // 摘要必须真的更短：小对话的"摘要"可能比原文还长，那就不如不压
      if (
        generated &&
        generated.length <= SUMMARY_MAX_CHARS &&
        estimateTextTokens(generated) < prefixTokens
      ) {
        summary = generated
      }
    } catch {
      // Provider 失败或超时：走确定性回退
    }
    if (!summary) summary = fallbackSummary(prefix)

    this.deps.repo.compactThrough(sessionId, throughSeq, {
      id: randomUUID(),
      content: summary,
      toolCallsJson: null,
      toolCallId: null,
      tokens: estimateTextTokens(summary),
      createdAt: Date.now()
    })

    const after = estimateMessagesTokens(this.deps.repo.list(sessionId))
    return {
      compacted: true,
      dropped: prefix.length,
      before,
      after,
      summary,
      reason: options.reason
    }
  }

  /** 最后手段：直接丢弃最旧条目，直到用量降到目标比例以内 */
  hardTrim(
    sessionId: string,
    options: { systemTokens: number; limit: number; targetRatio: number }
  ): number {
    const target = options.limit * options.targetRatio
    let entries = this.deps.repo.list(sessionId)
    let trimmed = 0
    while (entries.length > 1 && options.systemTokens + estimateMessagesTokens(entries) > target) {
      const throughSeq = trimThroughSeq(entries)
      const removed = this.deps.repo.deleteThrough(sessionId, throughSeq)
      trimmed += removed
      entries = entries.filter((entry) => entry.seq > throughSeq)
    }
    return trimmed
  }
}

/**
 * 一条 assistant(toolCalls) 与其后相连的 tool 结果构成一个不可分割的组。
 * 返回组在 entries 中的结束下标（独占）；非此类条目返回 start + 1。
 */
function toolGroupEnd(entries: AgentContextEntry[], start: number): number {
  const first = entries[start]
  if (!first || first.role !== 'assistant') return start + 1
  const calls = parseToolCalls(first.toolCallsJson)
  if (!calls.length) return start + 1
  const ids = new Set(calls.map((call) => call.id))
  let end = start + 1
  while (
    end < entries.length &&
    entries[end].role === 'tool' &&
    entries[end].toolCallId !== null &&
    ids.has(entries[end].toolCallId!)
  ) {
    end += 1
  }
  return end
}

/**
 * 把压缩切割点推到 tool 组边界之外：绝不让 assistant(toolCalls) 与其结果分家。
 * 优先向后移到组尾（保留更多近期上下文），组尾已是末尾时再向前移到组首。
 */
function alignCutToToolBoundary(entries: AgentContextEntry[], desired: number): number {
  let cut = Math.max(1, Math.min(desired, entries.length))
  for (let index = 0; index < cut; ) {
    const end = toolGroupEnd(entries, index)
    if (end - 1 === index) {
      index += 1 // 普通条目，不是组
      continue
    }
    if (cut > index && cut < end) {
      cut = end < entries.length ? end : Math.max(1, index)
    }
    index = Math.max(index + 1, end)
  }
  return cut
}

/** hardTrim 删除最旧条目时，若它是 tool 组首则连同组内结果一起删，避免留下孤立 tool */
function trimThroughSeq(entries: AgentContextEntry[]): number {
  if (!entries.length) return 0
  const end = toolGroupEnd(entries, 0)
  return entries[Math.max(0, end - 1)].seq
}

/**
 * toMessages 前的最后一道防线：丢弃没有前置 toolCalls 的 tool 结果，
 * 并裁掉没有结果伴随的 toolCalls（两者都会让 Provider 返回 400）。
 */
function sanitizeToolPairs(entries: AgentContextEntry[]): AgentContextEntry[] {
  const declared = new Set<string>()
  const results = new Set<string>()
  for (const entry of entries) {
    if (entry.role === 'assistant') {
      for (const call of parseToolCalls(entry.toolCallsJson)) declared.add(call.id)
    } else if (entry.role === 'tool' && entry.toolCallId) {
      results.add(entry.toolCallId)
    }
  }
  const cleaned: AgentContextEntry[] = []
  for (const entry of entries) {
    if (entry.role === 'tool') {
      if (entry.toolCallId && declared.has(entry.toolCallId)) cleaned.push(entry)
      continue
    }
    if (entry.role === 'assistant') {
      const calls = parseToolCalls(entry.toolCallsJson)
      if (calls.length) {
        const matched = calls.filter((call) => results.has(call.id))
        // 声明的调用全部没有结果：空 assistant 也会被 Provider 拒绝，整条丢弃
        if (!matched.length && !entry.content.trim() && !entry.reasoningContent) continue
        cleaned.push({
          ...entry,
          toolCallsJson: matched.length ? JSON.stringify(matched) : null
        })
        continue
      }
    }
    cleaned.push(entry)
  }
  return cleaned
}

function parseToolCalls(json: string | null): NonNullable<AgentMessage['toolCalls']> {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is { id: string; name: string; argumentsJson: string } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string' &&
        typeof (item as { argumentsJson?: unknown }).argumentsJson === 'string'
    )
  } catch {
    return []
  }
}
