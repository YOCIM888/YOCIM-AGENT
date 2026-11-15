import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  AgentToolRuntime,
  ChatProvider,
  ToolCall,
  ToolDefinition,
  ToolExecutionOutcome
} from '../../shared/agent'
import { AppError } from '../../shared/errors'
import type { ChatSendRequest } from '../../shared/ipc'
import type { MessageRepository, SessionRepository } from '../db/repositories'
import { runAgentTurn } from './agentEngine'

const DEFAULT_SYSTEM_PROMPT = [
  '你是 YOCIM AGRNT，一个本地优先的桌面 AI 编程助手。',
  '回答保持简洁、具体，优先给出可执行的下一步。',
  '不要编造未读取的文件内容；不确定时明确说明。',
  '需要读取或修改工作区时，使用提供的工具，并遵守工作区边界。'
].join('\n')

const DEFAULT_TITLE_PATTERN = /^会话 \d+$/

export interface AgentToolContext {
  sessionId: string
  runId: string
  signal: AbortSignal
}

export interface AgentPersistence {
  sessions: SessionRepository
  messages: MessageRepository
}

export interface AgentServiceDeps {
  resolveProvider: () => ChatProvider
  emit: (event: AgentEvent) => void
  systemPrompt?: string
  toolDefinitions?: ToolDefinition[]
  toolExecutor?: (call: ToolCall, context: AgentToolContext) => Promise<ToolExecutionOutcome>
  persist?: AgentPersistence
}

export class AgentService {
  private readonly runs = new Map<string, AbortController>()

  constructor(private readonly deps: AgentServiceDeps) {}

  start(input: ChatSendRequest): { runId: string } {
    const session = this.deps.persist?.sessions.get(input.sessionId) ?? null
    if (this.deps.persist && !session) {
      throw new AppError('E_NOT_FOUND', '会话不存在，请新建会话后再发送')
    }

    const provider = this.deps.resolveProvider()
    const runId = randomUUID()
    const controller = new AbortController()
    this.runs.set(runId, controller)

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
          createdAt: Date.now()
        })
      }
      this.deps.emit(event)
    }

    const executor = this.deps.toolExecutor
    const tools: AgentToolRuntime | undefined = executor
      ? {
          definitions: this.deps.toolDefinitions ?? [],
          execute: (call, signal) => executor(call, { sessionId: input.sessionId, runId, signal })
        }
      : undefined

    void runAgentTurn(
      {
        provider,
        systemPrompt: this.deps.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        tools,
        emit
      },
      {
        runId,
        sessionId: input.sessionId,
        history: input.history,
        userText: input.text
      },
      controller.signal
    )
      .catch((error: unknown) => {
        console.error('[agent] run failed unexpectedly', error)
      })
      .finally(() => {
        this.runs.delete(runId)
      })

    return { runId }
  }

  cancel(runId: string): boolean {
    const controller = this.runs.get(runId)
    if (!controller) return false
    controller.abort()
    return true
  }

  activeRunCount(): number {
    return this.runs.size
  }
}
