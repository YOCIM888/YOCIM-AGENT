import type {
  ChatProvider,
  ProviderEvent,
  ProviderFinishReason,
  ProviderRequest
} from '../../../shared/agent'
import type { ReasoningEffort } from '../../../shared/providers'

type FetchFn = (input: string, init: RequestInit) => Promise<Response>

export interface OpenAICompatibleProviderOptions {
  baseUrl: string
  apiKey: string
  model: string
  /** 思考强度：default 时不发送 reasoning_effort，兼容不支持该参数的模型 */
  reasoningEffort?: ReasoningEffort
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
  /** DeepSeek 等推理模型在思考模式下返回的隐藏思考内容 */
  reasoning_content?: string | null
  reasoning?: string | null
  tool_calls?: OpenAIStreamToolCallDelta[]
}

interface OpenAIStreamChoice {
  delta?: OpenAIStreamDelta
  finish_reason?: string | null
}

interface OpenAIStreamChunk {
  choices?: OpenAIStreamChoice[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    input_tokens?: number
    output_tokens?: number
  }
}

interface PendingToolCall {
  id: string
  name: string
  argumentsJson: string
}

/** 400 的原始响应体往往写着真正的拒绝原因，别只给用户一个状态码。 */
async function describeHttpError(response: Response): Promise<string> {
  let detail = ''
  try {
    const text = await response.clone().text()
    if (text) {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
      const error = parsed.error
      detail = (typeof error === 'string' ? error : error?.message) ?? parsed.message ?? text
      detail = detail.replace(/\s+/g, ' ').trim().slice(0, 800)
    }
  } catch {
    // 错误体不是 JSON 或流已关闭：保留状态码即可
  }
  return `Provider 返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`
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
            ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}),
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
    if (this.options.reasoningEffort && this.options.reasoningEffort !== 'default') {
      body.reasoning_effort = this.options.reasoningEffort
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

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.options.apiKey) {
      headers.Authorization = `Bearer ${this.options.apiKey}`
    }

    const send = async (withUsage: boolean): Promise<Response> => {
      const payload = withUsage ? { ...body, stream_options: { include_usage: true } } : body
      return this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal
      })
    }

    let response = await send(true)
    if (!response.ok && response.status === 400) {
      // 个别 OpenAI 兼容服务不认 stream_options，去掉后重试一次（用量统计缺失不影响对话）
      response = await send(false)
    }

    if (!response.ok) {
      throw new Error(await describeHttpError(response))
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
        // 思考内容先于正文/工具调用到达；引擎会原样回传，供下一轮请求使用。
        const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          yield { type: 'reasoning', text: reasoning }
        }
        const content = choice?.delta?.content
        if (typeof content === 'string' && content.length > 0) {
          yield { type: 'text', text: content }
        }

        // stream_options.include_usage 打开后，最后一个 chunk 只带 usage
        if (chunk.usage) {
          const inputTokens = chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? 0
          const outputTokens = chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? 0
          if (inputTokens > 0 || outputTokens > 0) {
            yield { type: 'usage', usage: { inputTokens, outputTokens } }
          }
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
