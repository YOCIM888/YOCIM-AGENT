import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AgentService } from '../../src/main/agent/agentService'
import { MockProvider } from '../../src/main/agent/providers/mockProvider'
import { migrate } from '../../src/main/db/database'
import {
  AgentContextRepository,
  MessageRepository,
  SessionRepository
} from '../../src/main/db/repositories'
import { CONTEXT_WINDOW_DEFAULT, type ContextUsage } from '../../src/shared/context'
import type { AgentEvent, ChatProvider, ProviderEvent } from '../../src/shared/agent'

function createService(options: { contextWindow?: number } = {}): {
  db: DatabaseSync
  sessions: SessionRepository
  context: AgentContextRepository
  events: AgentEvent[]
  service: AgentService
} {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const sessions = new SessionRepository(db)
  const messages = new MessageRepository(db)
  const context = new AgentContextRepository(db)
  const events: AgentEvent[] = []
  const service = new AgentService({
    resolveProvider: () => new MockProvider({ delayMs: 0 }),
    emit: (event) => events.push(event),
    persist: { sessions, messages, context },
    contextWindow: () => options.contextWindow ?? CONTEXT_WINDOW_DEFAULT
  })
  return { db, sessions, context, events, service }
}

async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('AgentService 上下文管理', () => {
  it('replays the model-facing transcript across turns including tool results', async () => {
    const { db, sessions, context, events, service } = createService()
    const session = sessions.create({ title: '会话 1', workspaceRoot: null, projectId: null })

    service.start({ sessionId: session.id, text: '第一轮', history: [] })
    await waitFor(() => events.some((event) => event.type === 'run:done'))

    // 模拟上一轮的工具调用结果（由 onAppend 写入）
    context.append({
      id: 'tool-1',
      sessionId: session.id,
      role: 'tool',
      content: 'src/index.ts 的内容',
      toolCallsJson: null,
      toolCallId: 'call-1',
      tokens: 20,
      createdAt: Date.now()
    })

    events.length = 0
    service.start({ sessionId: session.id, text: '第二轮', history: [] })
    await waitFor(
      () =>
        events.some((event) => event.type === 'context:usage' && event.sessionId === session.id) &&
        events.some((event) => event.type === 'run:done')
    )

    const entries = context.list(session.id)
    expect(entries.map((entry) => entry.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
      'assistant'
    ])
    const usageEvent = events
      .filter(
        (event): event is Extract<AgentEvent, { type: 'context:usage' }> =>
          event.type === 'context:usage' && event.sessionId === session.id
      )
      .pop()
    expect(usageEvent?.usage.entries).toBe(5)
    expect(usageEvent?.usage.limit).toBe(CONTEXT_WINDOW_DEFAULT)
    db.close()
  })

  it('persists tool-only assistant messages with hidden reasoning', async () => {
    const { db, sessions, context, events } = createService()
    const session = sessions.create({ title: '工具会话', workspaceRoot: null, projectId: null })
    let round = 0
    const provider: ChatProvider = {
      async *stream(): AsyncGenerator<ProviderEvent> {
        round += 1
        if (round === 1) {
          yield { type: 'reasoning', text: '先列目录' }
          yield {
            type: 'tool_call',
            toolCall: { id: 'call-1', name: 'list_dir', argumentsJson: '{}' }
          }
          yield { type: 'done', finishReason: 'tool_calls' }
          return
        }
        yield { type: 'text', text: '完成' }
        yield { type: 'done', finishReason: 'stop' }
      }
    }
    const service = new AgentService({
      resolveProvider: () => provider,
      emit: (event) => events.push(event),
      toolDefinitions: [{ name: 'list_dir', description: 'list', parameters: { type: 'object' } }],
      toolExecutor: async () => ({ ok: true, content: 'a.txt', summary: 'a.txt' }),
      persist: { sessions: new SessionRepository(db), messages: new MessageRepository(db), context }
    })

    service.start({ sessionId: session.id, text: '列目录', history: [] })
    await waitFor(() => events.some((event) => event.type === 'run:done'))

    const entries = context.list(session.id)
    expect(entries.map((entry) => entry.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(entries[1]).toMatchObject({
      reasoningContent: '先列目录',
      toolCallsJson: expect.stringContaining('call-1')
    })
    db.close()
  })

  it('seeds context from legacy renderer history on first send', async () => {
    const { db, sessions, context, events, service } = createService()
    const session = sessions.create({ title: '旧会话', workspaceRoot: null, projectId: null })

    service.start({
      sessionId: session.id,
      text: '新问题',
      history: [
        { role: 'user', content: '旧问题' },
        { role: 'assistant', content: '旧回答' }
      ]
    })
    await waitFor(() => events.some((event) => event.type === 'run:done'))

    const roles = context.list(session.id).map((entry) => entry.role)
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant'])
    db.close()
  })

  it('compresses on demand and emits a compacted event', async () => {
    const { db, sessions, events, service } = createService()
    const session = sessions.create({ title: '压缩会话', workspaceRoot: null, projectId: null })

    for (const text of ['一', '二', '三']) {
      service.start({ sessionId: session.id, text, history: [] })
      await waitFor(() => service.activeRunCount() === 0)
    }

    const result = await service.compress(session.id)
    expect(result.compacted).toBe(true)
    expect(result.usage.entries).toBeLessThan(6)
    expect(result.usage.summaries).toBe(1)

    const compacted = events.find(
      (event): event is Extract<AgentEvent, { type: 'context:compacted' }> =>
        event.type === 'context:compacted'
    )
    expect(compacted?.reason).toBe('manual')
    expect(compacted?.dropped).toBeGreaterThan(0)
    db.close()
  })

  it('reports usage for unknown sessions (system prompt only)', async () => {
    const { db, service } = createService()
    const usage: ContextUsage = await service.usage('missing')
    expect(usage.entries).toBe(0)
    expect(usage.summaries).toBe(0)
    // system prompt 与工具定义本身就占窗口
    expect(usage.used).toBeGreaterThan(0)
    expect(usage.percent).toBeLessThan(0.05)
    db.close()
  })

  it('auto-compacts before a run when usage exceeds the threshold', async () => {
    const { db, sessions, context, events, service } = createService({ contextWindow: 200_000 })

    const session = sessions.create({ title: '自动压缩', workspaceRoot: null, projectId: null })

    // 预填 8 条大条目（~170k token），已经超过 80% 阈值
    const big = '长'.repeat(21_000)
    for (let index = 0; index < 8; index += 1) {
      context.append({
        id: `pre${index}`,
        sessionId: session.id,
        role: 'user',
        content: `${big} #${index}`,
        toolCallsJson: null,
        toolCallId: null,
        tokens: 21_000,
        createdAt: index
      })
    }

    service.start({ sessionId: session.id, text: '继续', history: [] })
    await waitFor(
      () =>
        events.some((event) => event.type === 'context:compacted') &&
        events.some((event) => event.type === 'run:done'),
      20_000
    )

    const compacted = events.find(
      (event): event is Extract<AgentEvent, { type: 'context:compacted' }> =>
        event.type === 'context:compacted'
    )
    expect(compacted?.reason).toBe('auto')
    expect(compacted?.dropped).toBeGreaterThan(0)
    db.close()
  })
})
