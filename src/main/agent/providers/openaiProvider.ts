import type {
  ChatProvider,
  ProviderEvent,
  ProviderFinishReason,
  ProviderRequest
} from '../../../shared/agent'

type FetchFn = (input: string, init: RequestInit) => Promise<Response>

export interface OpenAICompatibleProviderOptions {
  baseUrl: string
  apiKey: string
  model: string
  fetchImpl?: FetchFn
}

interface OpenAIStreamToolCallDelta {
  index?: number
  id?: string
  function?: {
    name?: string
    arguments?: string
  }
}

interface OpenAIStreamDelta {
  content?: string | null
  tool_calls?: OpenAIStreamToolCallDelta[]
}

interface OpenAIStreamChoice {
  delta?: OpenAIStreamDelta
  finish_reason?: string | null
}

interface OpenAIStreamChunk {
  choices?: OpenAIStreamChoice[]
}

interface PendingToolCall {
  id: string
  name: string
  argumentsJson: string
}

/**
 * OpenAI-compatible 流式 Provider（/chat/completions, stream: true）。
 * API Key 只保存在实例内，禁止写入日志。
 */
export class OpenAICompatibleProvider implements ChatProvider {
  private readonly options: OpenAICompatibleProviderOptions
  private readonly fetchImpl: FetchFn

  constructor(options: OpenAICompatibleProviderOptions) {
    this.options = options
    this.fetchImpl =
      options.fetchImpl ??
      ((input, init) => {
        return fetch(input, init)
      })
  }

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`
    const body: Record<string, unknown> = {
      model: this.options.model,
      stream: true,
      messages: request.messages.map((message) => {
        if (message.role === 'assistant') {
          return {
            role: 'assistant',
            content: message.content || null,
            ...(message.toolCalls?.length
              ? {
                  tool_calls: message.toolCalls.map((call) => ({
                    id: call.id,
                    type: 'function',
                    function: { name: call.name, arguments: call.argumentsJson }
                  }))
                }
              : {})
          }
        }
        if (message.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: message.toolCallId,
            content: message.content
          }
        }
        return { role: message.role, content: message.content }
      })
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      }))
    }

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      throw new Error(`Provider 返回 HTTP ${response.status}`)
    }
    if (!response.body) {
      throw new Error('Provider 未返回响应体')
    }

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    const pendingToolCalls = new Map<number, PendingToolCall>()
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
        if (payload === '[DONE]') {
          streamEnded = true
          break
        }

        let chunk: OpenAIStreamChunk
        try {
          chunk = JSON.parse(payload) as OpenAIStreamChunk
        } catch {
          continue
        }

        const choice = chunk.choices?.[0]
        const content = choice?.delta?.content
        if (typeof content === 'string' && content.length > 0) {
          yield { type: 'text', text: content }
        }

        for (const delta of choice?.delta?.tool_calls ?? []) {
          const index = delta.index ?? 0
          const pending = pendingToolCalls.get(index) ?? {
            id: '',
            name: '',
            argumentsJson: ''
          }
          if (delta.id) pending.id = delta.id
          if (delta.function?.name) pending.name = delta.function.name
          if (delta.function?.arguments) pending.argumentsJson += delta.function.arguments
          pendingToolCalls.set(index, pending)
        }

        if (choice?.finish_reason) {
          finishReason =
            choice.finish_reason === 'tool_calls'
              ? 'tool_calls'
              : choice.finish_reason === 'length'
                ? 'length'
                : 'stop'
        }
      }
    }

    for (const pending of pendingToolCalls.values()) {
      if (!pending.name) continue
      yield {
        type: 'tool_call',
        toolCall: {
          id: pending.id || 'call_unknown',
          name: pending.name,
          argumentsJson: pending.argumentsJson || '{}'
        }
      }
    }

    yield {
      type: 'done',
      finishReason: pendingToolCalls.size > 0 ? 'tool_calls' : finishReason
    }
  }
}
