import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AgentService } from '../../src/main/agent/agentService'
import { MockProvider } from '../../src/main/agent/providers/mockProvider'
import { migrate } from '../../src/main/db/database'
import { MessageRepository, SessionRepository } from '../../src/main/db/repositories'
import type { AgentEvent } from '../../src/shared/agent'

function createService(): {
  db: DatabaseSync
  sessions: SessionRepository
  messages: MessageRepository
  events: AgentEvent[]
  service: AgentService
} {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const sessions = new SessionRepository(db)
  const messages = new MessageRepository(db)
  const events: AgentEvent[] = []
  const service = new AgentService({
    resolveProvider: () => new MockProvider({ delayMs: 0 }),
    emit: (event) => events.push(event),
    persist: { sessions, messages }
  })
  return { db, sessions, messages, events, service }
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('AgentService persistence', () => {
  it('persists user and assistant messages and auto-titles the session', async () => {
    const { db, sessions, messages, events, service } = createService()
    const session = sessions.create({ title: '会话 1', workspaceRoot: null, projectId: null })

    service.start({ sessionId: session.id, text: '你好持久化', history: [] })
    await waitFor(
      () =>
        messages.listBySession(session.id).length >= 2 &&
        events.some((event) => event.type === 'run:done')
    )

    const stored = messages.listBySession(session.id)
    expect(stored.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(stored[0].content).toBe('你好持久化')
    expect(stored[1].content).toContain('Mock Provider')
    expect(sessions.get(session.id)?.title).toBe('你好持久化')
    db.close()
  })

  it('persists the reasoning chain with the assistant message', async () => {
    const { db, sessions, messages, events, service } = createService()
    const session = sessions.create({ title: '推理会话', workspaceRoot: null, projectId: null })

    service.start({ sessionId: session.id, text: '/think 演示', history: [] })
    await waitFor(() => events.some((event) => event.type === 'run:done'))

    const stored = messages.listBySession(session.id)
    expect(stored[1].role).toBe('assistant')
    expect(stored[1].reasoningContent).toContain('先拆解问题')
    expect(stored[1].content).toContain('思考完成：演示')
    db.close()
  })

  it('rejects sending into a missing session', () => {
    const { db, events, service } = createService()
    expect(() => service.start({ sessionId: 'missing', text: 'hi', history: [] })).toThrow(
      /会话不存在/
    )
    expect(events).toHaveLength(0)
    db.close()
  })
})
