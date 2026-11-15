import { describe, expect, it } from 'vitest'
import { buildSessionMarkdown } from '../../src/main/sessions/sessionExport'
import type { SessionSummary, StoredMessage } from '../../src/shared/session'

const session: SessionSummary = {
  id: 'session-1',
  title: '测试会话',
  workspaceRoot: 'E:/workspace',
  projectId: null,
  pinnedAt: null,
  archivedAt: null,
  createdAt: 1700000000000,
  updatedAt: 1700000001000
}

const messages: StoredMessage[] = [
  { id: 'm1', role: 'user', content: '你好', createdAt: 1700000000000 },
  { id: 'm2', role: 'assistant', content: '你好，有什么可以帮你？', createdAt: 1700000001000 }
]

describe('buildSessionMarkdown', () => {
  it('includes metadata and both roles', () => {
    const markdown = buildSessionMarkdown(session, messages)
    expect(markdown).toContain('# 测试会话')
    expect(markdown).toContain('- 会话 ID：session-1')
    expect(markdown).toContain('- 工作区：E:/workspace')
    expect(markdown).toContain('## 用户')
    expect(markdown).toContain('你好')
    expect(markdown).toContain('## 助手')
    expect(markdown).toContain('你好，有什么可以帮你？')
  })

  it('handles sessions without workspace or messages', () => {
    const markdown = buildSessionMarkdown({ ...session, workspaceRoot: null }, [])
    expect(markdown).toContain('未绑定')
    expect(markdown).not.toContain('## 用户')
  })
})
