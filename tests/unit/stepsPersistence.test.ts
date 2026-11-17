import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/database'
import { MessageRepository, SessionRepository } from '../../src/main/db/repositories'
import type { AgentStep } from '../../src/shared/agent'

function setup(): {
  db: DatabaseSync
  sessionId: string
  messages: MessageRepository
} {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const sessions = new SessionRepository(db)
  const session = sessions.create({ title: '步骤持久化', workspaceRoot: null, projectId: null })
  return { db, sessionId: session.id, messages: new MessageRepository(db) }
}

const step: AgentStep = {
  id: 'step-1',
  callId: 'call-1',
  name: 'read_file',
  argsSummary: 'hello.txt',
  status: 'done',
  startedAt: 100,
  endedAt: 220,
  summary: '读取完成',
  approval: { approvalId: 'approval-1', risk: 'medium', status: 'approved' },
  output: 'hello from e2e',
  images: []
}

describe('message timeline steps persistence', () => {
  it('stores steps and run timestamps alongside the message', () => {
    const { db, sessionId, messages } = setup()
    messages.upsertRunMessages(sessionId, [
      {
        id: 'msg-1',
        role: 'assistant',
        content: '正文',
        createdAt: 100,
        reasoningContent: '思考链',
        steps: [step],
        runStartedAt: 90,
        runEndedAt: 300
      }
    ])

    const stored = messages.listBySession(sessionId)
    expect(stored).toHaveLength(1)
    expect(stored[0].steps).toEqual([step])
    expect(stored[0].runStartedAt).toBe(90)
    expect(stored[0].runEndedAt).toBe(300)
    expect(stored[0].reasoningContent).toBe('思考链')
    db.close()
  })

  it('does not overwrite content persisted by message:done when refreshing steps', () => {
    const { db, sessionId, messages } = setup()
    messages.insert({
      id: 'msg-2',
      sessionId,
      role: 'assistant',
      content: '主进程完整正文',
      reasoningContent: '主进程完整思考',
      createdAt: 200
    })
    messages.upsertRunMessages(sessionId, [
      {
        id: 'msg-2',
        role: 'assistant',
        content: '旧快照',
        reasoningContent: '旧快照思考',
        createdAt: 200,
        steps: [step]
      }
    ])

    const stored = messages.listBySession(sessionId)[0]
    expect(stored.content).toBe('主进程完整正文')
    expect(stored.reasoningContent).toBe('主进程完整思考')
    expect(stored.steps).toEqual([step])
    db.close()
  })

  it('survives malformed legacy steps_json without dropping the message', () => {
    const { db, sessionId, messages } = setup()
    messages.upsertRunMessages(sessionId, [
      { id: 'msg-3', role: 'assistant', content: '正文', createdAt: 300, steps: [step] }
    ])
    db.prepare("UPDATE messages SET steps_json = 'not json' WHERE id = 'msg-3'").run()

    const stored = messages.listBySession(sessionId)[0]
    expect(stored.content).toBe('正文')
    expect(stored.steps).toBeUndefined()
    db.close()
  })
})
