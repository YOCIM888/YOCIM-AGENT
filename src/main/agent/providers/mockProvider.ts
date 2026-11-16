import type { ChatProvider, ProviderEvent, ProviderRequest, ToolCall } from '../../../shared/agent'

export interface MockProviderOptions {
  chunkSize?: number
  delayMs?: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function splitByLength(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size))
  }
  return chunks
}

/**
 * 离线演示/测试命令：
 *   /tool read <path>       -> read_file
 *   /tool write <path>      -> write_file（触发审批）
 *   /tool command <command> -> run_command（触发审批）
 *   /tool plan a,b,c        -> update_plan（第一步 doing）
 *   /think <内容>           -> 先流式输出思考链，再给正文（思考块 UI 演示）
 */
function parseToolDemo(text: string): ToolCall | null {
  const match = /^\/tool\s+(read|write|command|plan)\s+(.+)$/i.exec(text.trim())
  if (!match) return null

  const action = match[1].toLowerCase()
  const value = match[2].trim()
  if (!value) return null

  const id = `call_${Date.now().toString(36)}`
  if (action === 'plan') {
    const steps = value
      .split(/[,，]/)
      .map((step) => step.trim())
      .filter(Boolean)
      .slice(0, 20)
    return {
      id,
      name: 'update_plan',
      argumentsJson: JSON.stringify({
        plan: steps.map((step, index) => ({ step, status: index === 0 ? 'doing' : 'pending' }))
      })
    }
  }
  if (action === 'read') {
    return { id, name: 'read_file', argumentsJson: JSON.stringify({ relativePath: value }) }
  }
  if (action === 'write') {
    return {
      id,
      name: 'write_file',
      argumentsJson: JSON.stringify({ relativePath: value, content: 'mock tool demo\n' })
    }
  }
  return { id, name: 'run_command', argumentsJson: JSON.stringify({ command: value }) }
}

/**
 * 离线测试用 Provider：按固定分片和延迟流式返回，不访问网络。
 * 收到 tool 结果后会总结结果，便于验证完整工具循环。
 */
export class MockProvider implements ChatProvider {
  private readonly chunkSize: number
  private readonly delayMs: number

  constructor(options: MockProviderOptions = {}) {
    this.chunkSize = options.chunkSize ?? 6
    this.delayMs = options.delayMs ?? 12
  }

  private async *streamText(text: string, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    for (const chunk of splitByLength(text, this.chunkSize)) {
      if (signal.aborted) return
      await delay(this.delayMs)
      if (signal.aborted) return
      yield { type: 'text', text: chunk }
    }
    yield { type: 'done', finishReason: 'stop' }
  }

  private async *streamThinking(text: string, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    const reasoning = '先拆解问题，确认关键约束；再逐步验证，最后汇总结论。'
    for (const chunk of splitByLength(reasoning, Math.max(2, Math.floor(this.chunkSize / 2)))) {
      if (signal.aborted) return
      await delay(this.delayMs)
      if (signal.aborted) return
      yield { type: 'reasoning', text: chunk }
    }
    yield* this.streamText(`思考完成：${text}`, signal)
  }

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    const lastMessage = request.messages[request.messages.length - 1]
    if (lastMessage?.role === 'tool') {
      const summary =
        lastMessage.content.length > 400
          ? `${lastMessage.content.slice(0, 400)}…`
          : lastMessage.content
      yield* this.streamText(`工具执行完成：${summary}`, signal)
      return
    }

    const lastUser = [...request.messages].reverse().find((message) => message.role === 'user')
    const thinking = /^\/think(?:\s+(.*))?$/is.exec(lastUser?.content ?? '')
    if (thinking) {
      yield* this.streamThinking(thinking[1]?.trim() || '演示', signal)
      return
    }
    const toolCall = parseToolDemo(lastUser?.content ?? '')
    if (toolCall) {
      yield { type: 'tool_call', toolCall }
      yield { type: 'done', finishReason: 'tool_calls' }
      return
    }

    yield* this.streamText(`Mock Provider 已收到：${lastUser?.content ?? '（空消息）'}`, signal)
  }
}
