import type {
  AgentMessage,
  ChatProvider,
  ProviderEvent,
  ProviderFinishReason,
  ProviderRequest
} from '../../../shared/agent'

type FetchFn = (input: string, init: RequestInit) => Promise<Response>

export interface AnthropicProviderOptions {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens?: number
  fetchImpl?: FetchFn
}

interface AnthropicTextBlock {
  type: 'text'
  text: string
}

interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

interface AnthropicStreamEvent {
  type?: string
  index?: number
  content_block?: {
    type?: string
    id?: string
    name?: string
  }
  delta?: {
    type?: string
    text?: string
    partial_json?: string
    stop_reason?: string | null
  }
  error?: { message?: string }
}

interface PendingToolUse {
  id: string
  name: string
  json: string
}

function parseArguments(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}

function mergeMessages(
  messages: AnthropicMessage[],
  role: 'user' | 'assistant',
  blocks: AnthropicContentBlock[]
): void {
  const last = messages[messages.length - 1]
  if (last && last.role === role) {
    last.content.push(...blocks)
    return
  }
  messages.push({ role, content: blocks })
}

function toAnthropicMessages(messages: AgentMessage[]): {
  system: string
  messages: AnthropicMessage[]
} {
  const systemParts: string[] = []
  const result: AnthropicMessage[] = []
  const pendingToolResults: AnthropicToolResultBlock[] = []

  const flushToolResults = (): void => {
    if (!pendingToolResults.length) return
    mergeMessages(result, 'user', pendingToolResults.splice(0))
  }

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }
    if (message.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? '',
        content: message.content
      })
      continue
    }
    flushToolResults()

    if (message.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = []
      if (message.content) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: parseArguments(call.argumentsJson)
        })
      }
      mergeMessages(result, 'assistant', blocks)
      continue
    }

    mergeMessages(result, 'user', [{ type: 'text', text: message.content }])
  }
  flushToolResults()
  return { system: systemParts.join('\n\n'), messages: result }
}

async function describeHttpError(response: Response): Promise<string> {
  let detail = ''
  try {
    const text = await response.text()
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    detail = parsed.error?.message ?? ''
  } catch {
    // 忽略错误体解析失败
  }
  return `Anthropic 返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`
}

/**
 * Anthropic Messages API 流式 Provider。
 * 支持文本与 tool_use / tool_result 转换；API Key 仅保存在实例内。
 */
export class AnthropicProvider implements ChatProvider {
  private readonly options: AnthropicProviderOptions
  private readonly fetchImpl: FetchFn

  constructor(options: AnthropicProviderOptions) {
    this.options = options
    this.fetchImpl =
      options.fetchImpl ??
      ((input, init) => {
        return fetch(input, init)
      })
  }

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    const baseUrl = this.options.baseUrl.replace(/\/+$/, '')
    const url = baseUrl.endsWith('/messages') ? baseUrl : `${baseUrl}/messages`
    const converted = toAnthropicMessages(request.messages)
    const body: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: this.options.maxTokens ?? 4096,
      stream: true,
      messages: converted.messages
    }
    if (converted.system) body.system = converted.system
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }))
    }

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) throw new Error(await describeHttpError(response))
    if (!response.body) throw new Error('Anthropic 未返回响应体')

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    const pendingTools = new Map<number, PendingToolUse>()
    let buffer = ''
    let finishReason: ProviderFinishReason = 'stop'
    let streamEnded = false

    while (!streamEnded) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')

        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue

        let event: AnthropicStreamEvent
        try {
          event = JSON.parse(payload) as AnthropicStreamEvent
        } catch {
          continue
        }

        if (event.type === 'error') {
          throw new Error(event.error?.message ?? 'Anthropic 流式响应出错')
        }
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          const index = event.index ?? pendingTools.size
          pendingTools.set(index, {
            id: event.content_block.id ?? `call_${index}`,
            name: event.content_block.name ?? '',
            json: ''
          })
        }
        if (event.type === 'content_block_delta') {
          const delta = event.delta
          if (delta?.type === 'text_delta' && delta.text) {
            yield { type: 'text', text: delta.text }
          }
          if (delta?.type === 'input_json_delta' && typeof event.index === 'number') {
            const pending = pendingTools.get(event.index)
            if (pending) pending.json += delta.partial_json ?? ''
          }
        }
        if (event.type === 'message_delta' && event.delta?.stop_reason) {
          const reason = event.delta.stop_reason
          finishReason =
            reason === 'tool_use' ? 'tool_calls' : reason === 'max_tokens' ? 'length' : 'stop'
        }
        if (event.type === 'message_stop') {
          streamEnded = true
          break
        }
      }
    }

    for (const pending of pendingTools.values()) {
      if (!pending.name) continue
      yield {
        type: 'tool_call',
        toolCall: {
          id: pending.id,
          name: pending.name,
          argumentsJson: pending.json || '{}'
        }
      }
    }

    yield {
      type: 'done',
      finishReason: pendingTools.size > 0 ? 'tool_calls' : finishReason
    }
  }
}
