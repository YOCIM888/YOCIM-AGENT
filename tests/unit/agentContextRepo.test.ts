import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/database'
import { AgentContextRepository, SessionRepository } from '../../src/main/db/repositories'

function createRepo(): {
  db: DatabaseSync
  repo: AgentContextRepository
  sessionId: string
  otherSessionId: string
} {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const sessions = new SessionRepository(db)
  return {
    db,
    repo: new AgentContextRepository(db),
    sessionId: sessions.create({ title: 's', workspaceRoot: null, projectId: null }).id,
    otherSessionId: sessions.create({ title: 's2', workspaceRoot: null, projectId: null }).id
  }
}

const BASE = {
  toolCallsJson: null,
  toolCallId: null,
  tokens: 10,
  createdAt: 1
}

describe('AgentContextRepository', () => {
  it('appends entries with monotonic seq and lists them in order', () => {
    const { db, repo, sessionId } = createRepo()
    const first = repo.append({
      id: 'a',
      sessionId,
      role: 'user',
      content: '一',
      ...BASE
    })
    const second = repo.append({
      id: 'b',
      sessionId,
      role: 'assistant',
      content: '二',
      ...BASE
    })
    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(repo.list(sessionId).map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(repo.nextSeq(sessionId)).toBe(3)
    db.close()
  })

  it('keeps sessions isolated', () => {
    const { db, repo, sessionId, otherSessionId } = createRepo()
    repo.append({ id: 'a', sessionId, role: 'user', content: 'x', ...BASE })
    repo.append({ id: 'b', sessionId: otherSessionId, role: 'user', content: 'y', ...BASE })
    expect(repo.list(sessionId)).toHaveLength(1)
    expect(repo.countBySession(otherSessionId).entries).toBe(1)
    db.close()
  })

  it('replaces a prefix with a single summary entry', () => {
    const { db, repo, sessionId } = createRepo()
    for (let index = 0; index < 5; index += 1) {
      repo.append({
        id: `e${index}`,
        sessionId,
        role: 'user',
        content: `m${index}`,
        ...BASE
      })
    }
    const summary = repo.compactThrough(sessionId, 3, {
      id: 'sum',
      content: '早前内容摘要',
      toolCallsJson: null,
      toolCallId: null,
      tokens: 50,
      createdAt: 99
    })
    expect(summary.role).toBe('summary')
    const remaining = repo.list(sessionId)
    expect(remaining.map((entry) => entry.id)).toEqual(['sum', 'e3', 'e4'])
    expect(remaining[0].seq).toBe(3)
    expect(repo.countBySession(sessionId)).toEqual({ entries: 3, summaries: 1 })
    expect(repo.latestSummaryAt(sessionId)).toBe(99)
    db.close()
  })

  it('hard-deletes a prefix and reports the removed count', () => {
    const { db, repo, sessionId } = createRepo()
    for (let index = 0; index < 4; index += 1) {
      repo.append({
        id: `e${index}`,
        sessionId,
        role: 'user',
        content: `m${index}`,
        ...BASE
      })
    }
    expect(repo.deleteThrough(sessionId, 2)).toBe(2)
    expect(repo.list(sessionId).map((entry) => entry.id)).toEqual(['e2', 'e3'])
    db.close()
  })

  it('clears a session', () => {
    const { db, repo, sessionId } = createRepo()
    repo.append({ id: 'a', sessionId, role: 'user', content: 'x', ...BASE })
    repo.clear(sessionId)
    expect(repo.list(sessionId)).toHaveLength(0)
    db.close()
  })
})
