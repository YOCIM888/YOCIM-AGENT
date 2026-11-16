import type {
  AgentMessage,
  ChatProvider,
  ProviderEvent,
  ProviderFinishReason,
  ProviderRequest
} from '../../../shared/agent'
import type { ReasoningEffort } from '../../../shared/providers'

type FetchFn = (input: string, init: RequestInit) => Promise<Response>

export interface GeminiProviderOptions {
  baseUrl: string
  apiKey: string
  model: string
  /** 思考强度：default 时不发送 thinkingConfig */
  reasoningEffort?: ReasoningEffort
  fetchImpl?: FetchFn
}

interface GeminiPart {
  text?: string
  functionCall?: {
    name?: string
    args?: Record<string, unknown>
  }
  functionResponse?: {
    name: string
    response: { content: string }
  }
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiStreamPayload {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] }
    finishReason?: string
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  error?: { message?: string }
}

function parseArguments(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function mergeContent(
  contents: GeminiContent[],
  role: 'user' | 'model',
  parts: GeminiPart[]
): void {
  if (!parts.length) return
  const last = contents[contents.length - 1]
  if (last && last.role === role) {
    last.parts.push(...parts)
    return
  }
  contents.push({ role, parts })
}

function toGeminiContents(messages: AgentMessage[]): {
  system: string
  contents: GeminiContent[]
} {
  const systemParts: string[] = []
  const contents: GeminiContent[] = []
  const toolNames = new Map<string, string>()

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }
    if (message.role === 'user') {
      mergeContent(contents, 'user', [{ text: message.content }])
      continue
    }
    if (message.role === 'assistant') {
      const parts: GeminiPart[] = []
      if (message.content) parts.push({ text: message.content })
      for (const call of message.toolCalls ?? []) {
        toolNames.set(call.id, call.name)
        parts.push({
          functionCall: {
            name: call.name,
            args: parseArguments(call.argumentsJson)
          }
        })
      }
      mergeContent(contents, 'model', parts)
      continue
    }
    mergeContent(contents, 'user', [
      {
        functionResponse: {
          name: (message.toolCallId && toolNames.get(message.toolCallId)) || 'tool',
          response: { content: message.content }
        }
      }
    ])
  }

  return { system: systemParts.join('\n\n'), contents }
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
  return `Gemini 返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`
}

/**
 * Google Gemini GenerateContent 流式 Provider（alt=sse）。
 * 支持文本与 functionCall / functionResponse 转换；API Key 仅保存在实例内。
 */
/** 思考强度 → thinkingBudget；default 不发送该字段 */
const GEMINI_THINKING_BUDGETS: Record<string, number | undefined> = {
  default: undefined,
  low: 1024,
  medium: 4096,
  high: 8192
}

export class GeminiProvider implements ChatProvider {
  private readonly options: GeminiProviderOptions
  private readonly fetchImpl: FetchFn

  constructor(options: GeminiProviderOptions) {
    this.options = options
    this.fetchImpl =
      options.fetchImpl ??
      ((input, init) => {
        return fetch(input, init)
      })
  }

  async *stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    const baseUrl = this.options.baseUrl.replace(/\/+$/, '')
    const model = this.options.model.replace(/^models\//, '')
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
    const converted = toGeminiContents(request.messages)
    const body: Record<string, unknown> = {
      contents: converted.contents
    }
    if (converted.system) {
      body.systemInstruction = { parts: [{ text: converted.system }] }
    }
    const thinkingBudget = GEMINI_THINKING_BUDGETS[this.options.reasoningEffort ?? 'default']
    if (thinkingBudget !== undefined) {
      body.generationConfig = { thinkingConfig: { thinkingBudget } }
    }
    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }))
        }
      ]
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.options.apiKey) headers['x-goog-api-key'] = this.options.apiKey

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) throw new Error(await describeHttpError(response))
    if (!response.body) throw new Error('Gemini 未返回响应体')

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    let buffer = ''
    let finishReason: ProviderFinishReason = 'stop'
    let toolCallCount = 0
    let inputTokens = 0
    let outputTokens = 0

    for (;;) {
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

        let chunk: GeminiStreamPayload
        try {
          chunk = JSON.parse(payload) as GeminiStreamPayload
        } catch {
          continue
        }
        if (chunk.error?.message) {
          throw new Error(chunk.error.message)
        }

        const usage = chunk.usageMetadata
        if (usage) {
          if (typeof usage.promptTokenCount === 'number') inputTokens = usage.promptTokenCount
          if (typeof usage.candidatesTokenCount === 'number') {
            outputTokens = usage.candidatesTokenCount
          }
        }

        for (const candidate of chunk.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            if (typeof part.text === 'string' && part.text.length > 0) {
              yield { type: 'text', text: part.text }
            }
            if (part.functionCall?.name) {
              toolCallCount += 1
              yield {
                type: 'tool_call',
                toolCall: {
                  id: `call_${toolCallCount}_${Date.now().toString(36)}`,
                  name: part.functionCall.name,
                  argumentsJson: JSON.stringify(part.functionCall.args ?? {})
                }
              }
            }
          }
          if (candidate.finishReason) {
            finishReason =
              candidate.finishReason === 'MAX_TOKENS'
                ? 'length'
                : toolCallCount > 0
                  ? 'tool_calls'
                  : 'stop'
          }
        }
      }
    }

    if (inputTokens > 0 || outputTokens > 0) {
      yield { type: 'usage', usage: { inputTokens, outputTokens } }
    }

    yield {
      type: 'done',
      finishReason: toolCallCount > 0 ? 'tool_calls' : finishReason
    }
  }
}
