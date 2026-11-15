import type { SessionSummary, StoredMessage } from '../../shared/session'

export function buildSessionMarkdown(session: SessionSummary, messages: StoredMessage[]): string {
  const lines: string[] = [
    `# ${session.title}`,
    '',
    `- 会话 ID：${session.id}`,
    `- 工作区：${session.workspaceRoot ?? '未绑定'}`,
    `- 创建时间：${new Date(session.createdAt).toISOString()}`,
    `- 导出时间：${new Date().toISOString()}`,
    '',
    '---',
    ''
  ]

  for (const message of messages) {
    lines.push(message.role === 'user' ? '## 用户' : '## 助手', '', message.content, '')
  }

  return lines.join('\n')
}
