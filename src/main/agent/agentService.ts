import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  AgentMessage,
  AgentToolRuntime,
  ChatProvider,
  PlanItem,
  ProviderUsage,
  ToolCall,
  ToolDefinition,
  ToolExecutionOutcome
} from '../../shared/agent'
import {
  CONTEXT_AUTO_COMPACT_RATIO,
  CONTEXT_WINDOW_DEFAULT,
  estimateTextTokens,
  type ContextHint,
  type ContextUsage
} from '../../shared/context'
import { AppError } from '../../shared/errors'
import type { ChatSendInput } from '../../shared/ipc'
import type { AgentContextRepository } from '../db/repositories'
import { MessageRepository, SessionRepository } from '../db/repositories'
import { runAgentTurn } from './agentEngine'
import { ContextManager, type AutoCompactOutcome } from './contextManager'
import type { PlanStore } from './planStore'
import { buildRepoMap } from './repoMap'
import { buildSystemPrompt, type SystemPromptWorkspace } from './prompt'
import { loadWorkspaceRules } from './rules'

const DEFAULT_TITLE_PATTERN = /^会话 \d+$/

export interface AgentToolContext {
  sessionId: string
  runId: string
  signal: AbortSignal
}

export interface AgentPersistence {
  sessions: SessionRepository
  messages: MessageRepository
  /** 模型侧上下文流水；缺省时退回旧模式（只回放 renderer 传来的纯文本历史） */
  context?: AgentContextRepository
}

export interface AgentServiceDeps {
  resolveProvider: () => ChatProvider
  emit: (event: AgentEvent) => void
  systemPrompt?: string
  toolDefinitions?: ToolDefinition[] | (() => ToolDefinition[])
  toolExecutor?: (call: ToolCall, context: AgentToolContext) => Promise<ToolExecutionOutcome>
  persist?: AgentPersistence
  /** 当前工作区信息：注入 system prompt 的环境段 */
  workspaceInfo?: () => SystemPromptWorkspace | null
  /** 当前模型的上下文窗口（token） */
  contextWindow?: () => number
  /** 会话计划存储：每轮把当前计划回注入 system prompt */
  planStore?: PlanStore
  /** 每轮 token 用量上报（账单统计用） */
  onUsage?: (usage: ProviderUsage, sessionId: string) => void
  platform?: string
}

interface SessionRunState {
  controller: AbortController
}

export class AgentService {
  private readonly runs = new Map<string, SessionRunState>()
  private readonly sessionRuns = new Map<string, string>()

  constructor(private readonly deps: AgentServiceDeps) {}

  private contextManager(): ContextManager | null {
    const repo = this.deps.persist?.context
    if (!repo) return null
    return new ContextManager({ repo, provider: () => this.deps.resolveProvider() })
  }

  private toolDefinitions(): ToolDefinition[] {
    const source = this.deps.toolDefinitions
    return typeof source === 'function' ? source() : (source ?? [])
  }

  /**
   * 组装 system prompt（规则文件 / repo map 都在此读取）。
   * system token 的估算必须在 run 与用量查询之间保持一致，
   * 因此两处都走同一个方法。
   */
  private async resolveSystemPrompt(hint: ContextHint | null): Promise<string> {
    if (this.deps.systemPrompt) return this.deps.systemPrompt

    const workspace = this.deps.workspaceInfo?.() ?? null
    const rules = workspace ? await loadWorkspaceRules(workspace.root) : null
    let repoMap: string | null = null
    if (workspace && workspace.remote !== 'ssh') {
      try {
        repoMap = await buildRepoMap(workspace.root)
      } catch {
        repoMap = null
      }
    }
    return buildSystemPrompt({
      platform: this.deps.platform ?? process.platform,
      workspace,
      rules,
      repoMap,
      hint
    })
  }

  private systemTokens(prompt: string): number {
    // 工具定义同样占窗口，粗略计入
    return estimateTextTokens(prompt) + estimateTextTokens(JSON.stringify(this.toolDefinitions()))
  }

  start(input: ChatSendInput): { runId: string } {
    const session = this.deps.persist?.sessions.get(input.sessionId) ?? null
    if (this.deps.persist && !session) {
      throw new AppError('E_NOT_FOUND', '会话不存在，请新建会话后再发送')
    }

    const runId = randomUUID()
    const controller = new AbortController()
    this.runs.set(runId, { controller })
    this.sessionRuns.set(input.sessionId, runId)

    if (this.deps.persist) {
      const now = Date.now()
      this.deps.persist.messages.insert({
        id: randomUUID(),
        sessionId: input.sessionId,
        role: 'user',
        content: input.text,
        createdAt: now
      })
      this.deps.persist.sessions.touch(input.sessionId, now)
      if (session && DEFAULT_TITLE_PATTERN.test(session.title)) {
        const autoTitle = input.text.trim().slice(0, 30)
        if (autoTitle) {
          this.deps.persist.sessions.rename(input.sessionId, autoTitle)
        }
      }
    }

    void this.runTurn(input, runId, controller)
      .catch((error: unknown) => {
        console.error('[agent] run failed unexpectedly', error)
      })
      .finally(() => {
        this.runs.delete(runId)
        if (this.sessionRuns.get(input.sessionId) === runId) {
          this.sessionRuns.delete(input.sessionId)
        }
      })

    return { runId }
  }

  private async runTurn(
    input: ChatSendInput,
    runId: string,
    controller: AbortController
  ): Promise<void> {
    const context = this.contextManager()
    const limit = this.deps.contextWindow?.() ?? CONTEXT_WINDOW_DEFAULT
    const hint = (input.contextHint ?? null) as ContextHint | null
    const systemPrompt = await this.resolveSystemPrompt(hint)
    const tokens = this.systemTokens(systemPrompt)
    let autoCompact: AutoCompactOutcome | null = null

    if (context) {
      context.seedFromHistory(input.sessionId, input.history ?? [])
      context.appendMessage(input.sessionId, { role: 'user', content: input.text })
      try {
        autoCompact = await context.maybeAutoCompact(input.sessionId, {
          systemTokens: tokens,
          limit
        })
      } catch (error) {
        console.error('[agent] auto compact failed', error)
      }
    }

    /** 请求消息 = system（含当前计划）+ 上下文条目 + 附件块（附件不落库，每轮重建） */
    const assembleRequest = (): AgentMessage[] => {
      if (!context) return []
      const planText = this.deps.planStore?.renderForPrompt(input.sessionId) ?? null
      const systemContent = planText
        ? `${systemPrompt}\n\n## 当前计划\n（用 update_plan 更新；[x] 完成 / [~] 进行中 / [ ] 待办）\n${planText}`
        : systemPrompt
      return [
        { role: 'system', content: systemContent },
        ...context.toMessages(context.entries(input.sessionId)),
        ...buildAttachmentBlock(input.attachments)
      ]
    }

    const persistedMessageIds = new Set<string>()
    const emit = (event: AgentEvent): void => {
      if (
        event.type === 'message:done' &&
        this.deps.persist &&
        !persistedMessageIds.has(event.messageId)
      ) {
        persistedMessageIds.add(event.messageId)
        this.deps.persist.messages.insert({
          id: event.messageId,
          sessionId: input.sessionId,
          role: 'assistant',
          content: event.content,
          reasoningContent: event.reasoning,
          createdAt: Date.now()
        })
      }
      this.deps.emit(event)
    }

    const emitUsage = (): void => {
      if (!context) return
      emit({
        type: 'context:usage',
        runId,
        seq: 0,
        ts: Date.now(),
        sessionId: input.sessionId,
        usage: context.usage(input.sessionId, tokens, limit)
      })
    }

    const emitCompacted = (outcome: AutoCompactOutcome): void => {
      emit({
        type: 'context:compacted',
        runId,
        seq: 0,
        ts: Date.now(),
        sessionId: input.sessionId,
        reason: outcome.reason,
        before: outcome.before,
        after: outcome.after,
        dropped: outcome.dropped,
        summary: outcome.summary.slice(0, 160),
        usage: outcome.usage
      })
    }

    if (autoCompact?.compacted) emitCompacted(autoCompact)
    emitUsage()

    // Provider 配置错误（缺 API Key / Base URL）要立刻以错误卡呈现，
    // 不能在后台异步任务里被吞掉
    let provider: ChatProvider
    try {
      provider = this.deps.resolveProvider()
    } catch (error) {
      emit({
        type: 'run:error',
        runId,
        seq: 0,
        ts: Date.now(),
        code: 'E_PROVIDER',
        message: error instanceof Error ? error.message : '模型 Provider 配置错误'
      })
      emit({ type: 'run:done', runId, seq: 0, ts: Date.now(), reason: 'error' })
      return
    }

    await runAgentTurn(
      {
        provider,
        systemPrompt,
        tools: this.resolveTools(input.sessionId, runId),
        emit,
        onAppend: context
          ? (messages) => {
              for (const message of messages) {
                // 纯工具调用的助手消息 content 为空，但 toolCalls/reasoningContent
                // 必须入上下文，否则下一轮会出现孤立的 tool 消息并触发 Provider 400。
                if (!message.content.trim() && !message.toolCalls?.length) continue
                context.appendMessage(input.sessionId, message)
              }
            }
          : undefined,
        beforeRound: context
          ? async (messages) => {
              const current = context.usage(input.sessionId, tokens, limit)
              if (current.percent < CONTEXT_AUTO_COMPACT_RATIO) return messages
              try {
                const outcome = await context.maybeAutoCompact(input.sessionId, {
                  systemTokens: tokens,
                  limit
                })
                if (outcome.compacted) emitCompacted(outcome)
              } catch {
                // 压缩失败不阻塞运行
              }
              return assembleRequest()
            }
          : undefined,
        onUsage: this.deps.onUsage
          ? (usage) => {
              this.deps.onUsage?.(usage, input.sessionId)
            }
          : undefined
      },
      {
        runId,
        sessionId: input.sessionId,
        history: [],
        userText: input.text,
        attachments: context ? [] : input.attachments,
        prebuiltMessages: context ? assembleRequest() : undefined
      },
      controller.signal
    )

    emitUsage()
  }

  private resolveTools(sessionId: string, runId: string): AgentToolRuntime | undefined {
    const executor = this.deps.toolExecutor
    if (!executor) return undefined
    return {
      definitions: this.toolDefinitions(),
      execute: (call, signal) => executor(call, { sessionId, runId, signal })
    }
  }

  /** 手动压缩入口（用量圆环点击） */
  async compress(
    sessionId: string
  ): Promise<{ compacted: boolean; message: string; usage: ContextUsage }> {
    const context = this.contextManager()
    if (!context) {
      throw new AppError('E_UNSUPPORTED', '当前未启用上下文管理')
    }
    const activeRun = this.sessionRuns.get(sessionId)
    if (activeRun && this.runs.has(activeRun)) {
      throw new AppError('E_CONFLICT', '正在生成回复，请结束后再压缩上下文')
    }

    const limit = this.deps.contextWindow?.() ?? CONTEXT_WINDOW_DEFAULT
    const systemPrompt = await this.resolveSystemPrompt(null)
    const tokens = this.systemTokens(systemPrompt)
    const before = context.usage(sessionId, tokens, limit)

    const outcome = await context.compactManually(sessionId, { systemTokens: tokens, limit })
    const usage = context.usage(sessionId, tokens, limit)

    if (!outcome.compacted) {
      return { compacted: false, message: '对话内容较少，暂无需压缩。', usage }
    }

    this.deps.emit({
      type: 'context:compacted',
      runId: randomUUID(),
      seq: 0,
      ts: Date.now(),
      sessionId,
      reason: 'manual',
      before: outcome.before,
      after: outcome.after,
      dropped: outcome.dropped,
      summary: outcome.summary.slice(0, 160),
      usage
    })
    return {
      compacted: true,
      message: `已压缩上下文：${outcome.dropped} 条旧内容并入摘要，用量 ${Math.round(before.percent * 100)}% → ${Math.round(usage.percent * 100)}%。`,
      usage
    }
  }

  /** 当前会话计划（渲染层加载会话时拉取） */
  plan(sessionId: string): PlanItem[] {
    return this.deps.planStore?.get(sessionId) ?? []
  }

  async usage(sessionId: string): Promise<ContextUsage> {
    const context = this.contextManager()
    const limit = this.deps.contextWindow?.() ?? CONTEXT_WINDOW_DEFAULT
    if (!context) {
      return { used: 0, limit, percent: 0, entries: 0, summaries: 0, compactedAt: null }
    }
    const systemPrompt = await this.resolveSystemPrompt(null)
    return context.usage(sessionId, this.systemTokens(systemPrompt), limit)
  }

  cancel(runId: string): boolean {
    const state = this.runs.get(runId)
    if (!state) return false
    state.controller.abort()
    return true
  }

  activeRunCount(): number {
    return this.runs.size
  }
}

function buildAttachmentBlock(attachments: ChatSendInput['attachments']): AgentMessage[] {
  if (!attachments?.length) return []
  const blocks = attachments.map((attachment) => {
    const header = attachment.range
      ? `${attachment.relativePath}（第 ${attachment.range.startLine}-${attachment.range.endLine} 行）`
      : attachment.relativePath
    const language = attachment.language ?? ''
    const note = attachment.truncated ? '\n（内容已截断）' : ''
    return `### ${header}\n\`\`\`${language}\n${attachment.content}\n\`\`\`${note}`
  })
  return [
    {
      role: 'user',
      content: `以下是用户附加的上下文文件，仅供参考：\n\n${blocks.join('\n\n')}`
    }
  ]
}
