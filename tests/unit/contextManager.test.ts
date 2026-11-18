import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { ContextManager, fallbackSummary } from '../../src/main/agent/contextManager'
import { MockProvider } from '../../src/main/agent/providers/mockProvider'
import { migrate } from '../../src/main/db/database'
import { AgentContextRepository, SessionRepository } from '../../src/main/db/repositories'
import type { ChatProvider, ProviderEvent } from '../../src/shared/agent'

function createManager(provider: ChatProvider = new MockProvider({ delayMs: 0 })): {
  db: DatabaseSync
  repo: AgentContextRepository
  manager: ContextManager
  sessionId: string
} {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const repo = new AgentContextRepository(db)
  const sessionId = new SessionRepository(db).create({
    title: '测试会话',
    workspaceRoot: null,
    projectId: null
  }).id
  const manager = new ContextManager({ repo, provider: () => provider })
  return { db, repo, manager, sessionId }
}

function seed(repo: AgentContextRepository, sessionId: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    repo.append({
      id: `e${index}`,
      sessionId,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `消息 ${index} ${'内容'.repeat(200)}`,
      toolCallsJson: null,
      toolCallId: null,
      tokens: 400,
      createdAt: index
    })
  }
}

const failingProvider: ChatProvider = {
  async *stream(): AsyncGenerator<ProviderEvent> {
    throw new Error('provider down')
    yield { type: 'done', finishReason: 'stop' }
  }
}

describe('ContextManager', () => {
  it('maps summary/tool/assistant entries back to provider messages', () => {
    const { db, repo, manager, sessionId } = createManager()
    repo.append({
      id: 'sum',
      sessionId,
      seq: 1,
      role: 'summary',
      content: '早前摘要',
      toolCallsJson: null,
      toolCallId: null,
      tokens: 10,
      createdAt: 1
    })
    repo.append({
      id: 'a',
      sessionId,
      seq: 2,
      role: 'assistant',
      content: '我来查一下',
      toolCallsJson: JSON.stringify([{ id: 'c1', name: 'read_file', argumentsJson: '{}' }]),
      toolCallId: null,
      tokens: 10,
      createdAt: 2
    })
    repo.append({
      id: 't',
      sessionId,
      seq: 3,
      role: 'tool',
      content: '文件内容',
      toolCallsJson: null,
      toolCallId: 'c1',
      tokens: 10,
      createdAt: 3
    })

    const messages = manager.toMessages(repo.list(sessionId))
    expect(messages[0]).toMatchObject({ role: 'system' })
    expect(messages[0].content).toContain('早前摘要')
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '我来查一下',
      toolCalls: [{ id: 'c1', name: 'read_file' }]
    })
    expect(messages[2]).toMatchObject({ role: 'tool', toolCallId: 'c1' })
    db.close()
  })

  it('round-trips hidden reasoning content for tool-call assistant entries', () => {
    const { db, repo, manager, sessionId } = createManager()
    manager.appendMessage(sessionId, {
      role: 'assistant',
      content: '',
      reasoningContent: '先看目录',
      toolCalls: [{ id: 'c1', name: 'list_dir', argumentsJson: '{}' }]
    })
    manager.appendMessage(sessionId, {
      role: 'tool',
      toolCallId: 'c1',
      content: 'a.txt'
    })

    const entries = repo.list(sessionId)
    expect(entries[0].reasoningContent).toBe('先看目录')
    expect(manager.toMessages(entries)[0]).toMatchObject({
      role: 'assistant',
      reasoningContent: '先看目录'
    })
    db.close()
  })

  it('seeds legacy history only when the store is empty', () => {
    const { db, repo, manager, sessionId } = createManager()
    manager.seedFromHistory(sessionId, [
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答' }
    ])
    expect(repo.list(sessionId)).toHaveLength(2)
    manager.seedFromHistory(sessionId, [{ role: 'user', content: '不应重复' }])
    expect(repo.list(sessionId)).toHaveLength(2)
    db.close()
  })

  it('compacts the oldest prefix into a summary and keeps recent entries', async () => {
    const { db, repo, manager, sessionId } = createManager()
    seed(repo, sessionId, 6)
    const outcome = await manager.compactManually(sessionId, {
      systemTokens: 100,
      limit: 200_000
    })
    expect(outcome.compacted).toBe(true)
    expect(outcome.dropped).toBe(4) // 保留最近 2 条
    expect(outcome.before).toBeGreaterThan(outcome.after)
    const entries = repo.list(sessionId)
    expect(entries).toHaveLength(3)
    expect(entries[0].role).toBe('summary')
    // 小对话的 LLM"摘要"可能比原文更长：此时走确定性回退，绝不放大上下文
    expect(entries[0].content).toContain('用户此前的请求')
    expect(entries.slice(1).map((entry) => entry.id)).toEqual(['e4', 'e5'])
    db.close()
  })

  it('keeps assistant(toolCalls) and its tool results together across compaction', async () => {
    const { db, repo, manager, sessionId } = createManager()
    // 旧条目 → assistant(两个 toolCalls) → 两个 tool 结果，切割点按条目数恰好落在组内
    for (let index = 0; index < 6; index += 1) {
      repo.append({
        id: `old${index}`,
        sessionId,
        role: 'user',
        content: `旧消息 ${index}`,
        toolCallsJson: null,
        toolCallId: null,
        tokens: 100,
        createdAt: index
      })
    }
    repo.append({
      id: 'assistant-with-tools',
      sessionId,
      role: 'assistant',
      content: '',
      toolCallsJson: JSON.stringify([
        { id: 'c1', name: 'read_file', argumentsJson: '{}' },
        { id: 'c2', name: 'read_file', argumentsJson: '{}' }
      ]),
      toolCallId: null,
      tokens: 20,
      createdAt: 100
    })
    repo.append({
      id: 'tool-c1',
      sessionId,
      role: 'tool',
      content: '结果一',
      toolCallsJson: null,
      toolCallId: 'c1',
      tokens: 20,
      createdAt: 101
    })
    repo.append({
      id: 'tool-c2',
      sessionId,
      role: 'tool',
      content: '结果二',
      toolCallsJson: null,
      toolCallId: 'c2',
      tokens: 20,
      createdAt: 102
    })

    // manual 保留 2 条：若按条目数直切，保留的会是 tool-c1/tool-c2 两条孤立结果
    await manager.compactManually(sessionId, { systemTokens: 0, limit: 200_000 })
    const messages = manager.toMessages(repo.list(sessionId))
    const roles = messages.map((message) => message.role)
    const firstTool = roles.indexOf('tool')
    if (firstTool >= 0) {
      expect(messages[firstTool - 1]?.role).toBe('assistant')
      expect(messages[firstTool - 1]?.toolCalls?.some((call) => call.id === 'c1')).toBe(true)
    }
    // 兜底清洗后不应出现孤立 tool
    const declared = new Set(
      messages.flatMap((message) => (message.toolCalls ?? []).map((call) => call.id))
    )
    for (const message of messages) {
      if (message.role === 'tool') expect(declared.has(message.toolCallId ?? '')).toBe(true)
    }
    db.close()
  })

  it('drops orphan tools and unmatched toolCalls in toMessages', () => {
    const { db, repo, manager, sessionId } = createManager()
    repo.append({
      id: 'orphan',
      sessionId,
      role: 'tool',
      content: '没有前置调用的结果',
      toolCallsJson: null,
      toolCallId: 'missing',
      tokens: 5,
      createdAt: 1
    })
    repo.append({
      id: 'unmatched',
      sessionId,
      role: 'assistant',
      content: '',
      toolCallsJson: JSON.stringify([{ id: 'never', name: 'x', argumentsJson: '{}' }]),
      toolCallId: null,
      tokens: 5,
      createdAt: 2
    })
    const messages = manager.toMessages(repo.list(sessionId))
    expect(messages).toHaveLength(0)
    db.close()
  })

  it('falls back to a deterministic summary when the provider fails', async () => {
    const { db, repo, manager, sessionId } = createManager(failingProvider)
    repo.append({
      id: 'u1',
      sessionId,
      seq: 1,
      role: 'user',
      content: '请修复 src/app.ts 里的空指针问题',
      toolCallsJson: null,
      toolCallId: null,
      tokens: 40,
      createdAt: 1
    })
    repo.append({
      id: 'a1',
      sessionId,
      seq: 2,
      role: 'assistant',
      content: '已定位 src/app.ts 第 12 行',
      toolCallsJson: null,
      toolCallId: null,
      tokens: 40,
      createdAt: 2
    })
    repo.append({
      id: 'u2',
      sessionId,
      seq: 3,
      role: 'user',
      content: '继续',
      toolCallsJson: null,
      toolCallId: null,
      tokens: 5,
      createdAt: 3
    })
    const outcome = await manager.compactManually(sessionId, { systemTokens: 0, limit: 200_000 })
    expect(outcome.compacted).toBe(true)
    expect(outcome.summary).toContain('src/app.ts')
    expect(outcome.summary).toContain('用户此前的请求')
    db.close()
  })

  it('skips compaction when entries are few', async () => {
    const { db, repo, manager, sessionId } = createManager()
    seed(repo, sessionId, 2)
    const outcome = await manager.compactManually(sessionId, { systemTokens: 0, limit: 200_000 })
    expect(outcome.compacted).toBe(false)
    expect(repo.list(sessionId)).toHaveLength(2)
    db.close()
  })

  it('auto-compacts above the threshold and reports usage', async () => {
    const { db, repo, manager, sessionId } = createManager()
    // 200k 窗口下需要 ~160k token：写入大条目
    const big = '长'.repeat(160_000)
    for (let index = 0; index < 10; index += 1) {
      repo.append({
        id: `b${index}`,
        sessionId,
        role: 'user',
        content: `${big} #${index}`,
        toolCallsJson: null,
        toolCallId: null,
        tokens: 160_000,
        createdAt: index
      })
    }
    const outcome = await manager.maybeAutoCompact(sessionId, {
      systemTokens: 500,
      limit: 200_000
    })
    expect(outcome.compacted).toBe(true)
    expect(outcome.usage.percent).toBeLessThan(0.95)
    expect(repo.list(sessionId).length).toBeLessThan(10)
    db.close()
  }, 20_000)

  it('hard-trims entries that still exceed the window after compaction', () => {
    const { db, repo, manager, sessionId } = createManager()
    const huge = '长'.repeat(90_000)
    for (let index = 0; index < 6; index += 1) {
      repo.append({
        id: `h${index}`,
        sessionId,
        role: 'user',
        content: `${huge} #${index}`,
        toolCallsJson: null,
        toolCallId: null,
        tokens: 90_000,
        createdAt: index
      })
    }
    const trimmed = manager.hardTrim(sessionId, {
      systemTokens: 0,
      limit: 200_000,
      targetRatio: 0.8
    })
    expect(trimmed).toBeGreaterThan(0)
    expect(repo.list(sessionId).length).toBeLessThanOrEqual(2)
    db.close()
  })

  it('builds a readable fallback summary without provider', () => {
    const summary = fallbackSummary([
      {
        id: 'a',
        sessionId: 's',
        seq: 1,
        role: 'user',
        content: '把 README.md 重写一遍',
        toolCallsJson: null,
        toolCallId: null,
        tokens: 10,
        createdAt: 1
      }
    ])
    expect(summary).toContain('README.md')
    expect(summary).toContain('用户此前的请求')
  })
})
