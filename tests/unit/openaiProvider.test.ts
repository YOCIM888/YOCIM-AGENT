import { describe, expect, it } from 'vitest'
import { OpenAICompatibleProvider } from '../../src/main/agent/providers/openaiProvider'
import type { ProviderEvent } from '../../src/shared/agent'

function sseResponse(parts: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part))
      }
      controller.close()
    }
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

async function collect(provider: OpenAICompatibleProvider): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = []
  for await (const event of provider.stream(
    { messages: [{ role: 'user', content: 'hi' }] },
    new AbortController().signal
  )) {
    events.push(event)
  }
  return events
}

describe('OpenAICompatibleProvider', () => {
  it('parses SSE text deltas split across network chunks', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"，世界"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ]
    let requestedUrl = ''
    let authorization = ''
    let requestBody = ''

    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: async (url, init) => {
        requestedUrl = url
        authorization = (init.headers as Record<string, string>).Authorization
        requestBody = String(init.body)
        return sseResponse([lines[0].slice(0, 24), lines[0].slice(24) + lines[1], lines[2]])
      }
    })

    const events = await collect(provider)

    expect(events.filter((event) => event.type === 'text')).toEqual([
      { type: 'text', text: '你好' },
      { type: 'text', text: '，世界' }
    ])
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'stop' })
    expect(requestedUrl).toBe('https://api.example.com/v1/chat/completions')
    expect(authorization).toBe('Bearer test-key')
    expect(JSON.parse(requestBody)).toMatchObject({ model: 'test-model', stream: true })
  })

  it('accumulates streamed tool call fragments', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":\\""}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"a.txt\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
          'data: [DONE]\n\n'
        ])
    })

    const events = await collect(provider)
    expect(events).toContainEqual({
      type: 'tool_call',
      toolCall: { id: 'call_1', name: 'read_file', argumentsJson: '{"path":"a.txt"}' }
    })
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'tool_calls' })
  })

  it('throws on non-ok responses', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: async () => new Response('nope', { status: 401 })
    })

    await expect(collect(provider)).rejects.toThrow('Provider 返回 HTTP 401')
  })
})
