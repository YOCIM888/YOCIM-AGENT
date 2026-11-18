import { describe, expect, it } from 'vitest'
import type { ProviderEvent, ProviderRequest } from '../../src/shared/agent'
import { AnthropicProvider } from '../../src/main/agent/providers/anthropicProvider'
import { GeminiProvider } from '../../src/main/agent/providers/geminiProvider'

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(stream, { status: 200 })
}

async function collect(iterable: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

const tools = [
  {
    name: 'read_file',
    description: '读取文件',
    parameters: { type: 'object', properties: { relativePath: { type: 'string' } } }
  }
]

describe('AnthropicProvider', () => {
  it('streams text and maps stop reason', async () => {
    const fetchImpl = async (): Promise<Response> =>
      sseResponse([
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"！"}}\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n',
        'data: {"type":"message_stop"}\n'
      ])
    const provider = new AnthropicProvider({
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant',
      model: 'claude-sonnet-4-5',
      fetchImpl
    })

    const events = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal)
    )
    expect(events.filter((event) => event.type === 'text')).toEqual([
      { type: 'text', text: '你好' },
      { type: 'text', text: '！' }
    ])
    expect(events[events.length - 1]).toMatchObject({ type: 'done', finishReason: 'stop' })
  })

  it('aggregates tool_use deltas and sends converted messages', async () => {
    const captured: { url?: string; init?: RequestInit } = {}
    const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
      captured.url = url
      captured.init = init
      return sseResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file"}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"relativePath\\":"}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"a.txt\\"}"}}\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n',
        'data: {"type":"message_stop"}\n'
      ])
    }
    const provider = new AnthropicProvider({
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant',
      model: 'claude-sonnet-4-5',
      fetchImpl
    })
    const request: ProviderRequest = {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'read a' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_1', name: 'read_file', argumentsJson: '{"relativePath":"a.txt"}' }
          ]
        },
        { role: 'tool', toolCallId: 'call_1', content: 'file content' },
        { role: 'user', content: '继续' }
      ],
      tools
    }

    const events = await collect(provider.stream(request, new AbortController().signal))
    expect(events.find((event) => event.type === 'tool_call')).toMatchObject({
      type: 'tool_call',
      toolCall: { id: 'toolu_1', name: 'read_file', argumentsJson: '{"relativePath":"a.txt"}' }
    })
    expect(events[events.length - 1]).toMatchObject({ type: 'done', finishReason: 'tool_calls' })

    expect(captured.url).toBe('https://api.anthropic.com/v1/messages')
    const headers = captured.init?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant')
    expect(headers['anthropic-version']).toBe('2023-06-01')

    const body = JSON.parse(String(captured.init?.body)) as {
      system: string
      messages: Array<{ role: string; content: unknown[] }>
      tools: Array<{ name: string; input_schema: unknown }>
    }
    expect(body.system).toBe('sys')
    expect(body.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'read a' }] })
    expect(body.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_1', name: 'read_file' }]
    })
    expect(body.messages[2]).toMatchObject({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: 'file content' },
        { type: 'text', text: '继续' }
      ]
    })
    expect(body.tools[0].name).toBe('read_file')
  })

  it('streams thinking deltas and round-trips signed thinking blocks', async () => {
    const captured: { init?: RequestInit } = {}
    const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
      captured.init = init
      return sseResponse([
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"先想一步"}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-abc"}}\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n',
        'data: {"type":"message_stop"}\n'
      ])
    }
    const provider = new AnthropicProvider({
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant',
      model: 'claude-sonnet-4-5',
      reasoningEffort: 'medium',
      fetchImpl
    })
    const events = await collect(
      provider.stream(
        {
          messages: [
            { role: 'user', content: 'hi' },
            {
              role: 'assistant',
              content: '',
              reasoningContent: '上一轮思考',
              reasoningSignature: 'sig-prev',
              toolCalls: [
                { id: 'call_1', name: 'read_file', argumentsJson: '{"relativePath":"a.txt"}' }
              ]
            },
            { role: 'tool', toolCallId: 'call_1', content: 'file content' }
          ]
        },
        new AbortController().signal
      )
    )
    expect(events.filter((event) => event.type === 'reasoning')).toEqual([
      { type: 'reasoning', text: '先想一步' }
    ])
    expect(events.filter((event) => event.type === 'reasoning_signature')).toEqual([
      { type: 'reasoning_signature', signature: 'sig-abc' }
    ])

    const body = JSON.parse(String(captured.init?.body)) as {
      thinking?: { type: string; budget_tokens: number }
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>
    }
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 })
    expect(body.messages[1].content[0]).toEqual({
      type: 'thinking',
      thinking: '上一轮思考',
      signature: 'sig-prev'
    })
  })

  it('surfaces API error messages', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 })
    const provider = new AnthropicProvider({
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'bad',
      model: 'claude',
      fetchImpl
    })
    await expect(
      collect(
        provider.stream(
          { messages: [{ role: 'user', content: 'hi' }] },
          new AbortController().signal
        )
      )
    ).rejects.toThrow(/invalid api key/)
  })
})

describe('GeminiProvider', () => {
  it('streams text and function calls with converted request', async () => {
    const captured: { url?: string; init?: RequestInit } = {}
    const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
      captured.url = url
      captured.init = init
      return sseResponse([
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"你好"}]}}]}\n',
        'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"read_file","args":{"relativePath":"a.txt"}}}]},"finishReason":"STOP"}]}\n'
      ])
    }
    const provider = new GeminiProvider({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'gemini-key',
      model: 'gemini-2.5-pro',
      fetchImpl
    })
    const request: ProviderRequest = {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'read a' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_1', name: 'read_file', argumentsJson: '{"relativePath":"a.txt"}' }
          ]
        },
        { role: 'tool', toolCallId: 'call_1', content: 'file content' }
      ],
      tools
    }

    const events = await collect(provider.stream(request, new AbortController().signal))
    expect(events.filter((event) => event.type === 'text')).toEqual([
      { type: 'text', text: '你好' }
    ])
    expect(events.find((event) => event.type === 'tool_call')).toMatchObject({
      type: 'tool_call',
      toolCall: { name: 'read_file', argumentsJson: '{"relativePath":"a.txt"}' }
    })
    expect(events[events.length - 1]).toMatchObject({ type: 'done', finishReason: 'tool_calls' })

    expect(captured.url).toContain('/models/gemini-2.5-pro:streamGenerateContent?alt=sse')
    const headers = captured.init?.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('gemini-key')

    const body = JSON.parse(String(captured.init?.body)) as {
      systemInstruction: { parts: Array<{ text: string }> }
      contents: Array<{ role: string; parts: unknown[] }>
      tools: Array<{ functionDeclarations: Array<{ name: string }> }>
    }
    expect(body.systemInstruction.parts[0].text).toBe('sys')
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'read a' }] })
    expect(body.contents[1]).toMatchObject({
      role: 'model',
      parts: [{ functionCall: { name: 'read_file' } }]
    })
    expect(body.contents[2]).toMatchObject({
      role: 'user',
      parts: [{ functionResponse: { name: 'read_file', response: { content: 'file content' } } }]
    })
    expect(body.tools[0].functionDeclarations[0].name).toBe('read_file')
  })

  it('parses thought parts as reasoning and round-trips them', async () => {
    const captured: { init?: RequestInit } = {}
    const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
      captured.init = init
      return sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"内在推理","thought":true}]}}]}\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"回答"}]}}]}\n'
      ])
    }
    const provider = new GeminiProvider({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'gemini-key',
      model: 'gemini-2.5-pro',
      reasoningEffort: 'medium',
      fetchImpl
    })
    const events = await collect(
      provider.stream(
        {
          messages: [
            { role: 'user', content: 'hi' },
            {
              role: 'assistant',
              content: '',
              reasoningContent: '上一轮思考',
              toolCalls: [
                { id: 'call_1', name: 'read_file', argumentsJson: '{"relativePath":"a.txt"}' }
              ]
            },
            { role: 'tool', toolCallId: 'call_1', content: 'file content' }
          ]
        },
        new AbortController().signal
      )
    )
    expect(events.filter((event) => event.type === 'reasoning')).toEqual([
      { type: 'reasoning', text: '内在推理' }
    ])
    expect(events.filter((event) => event.type === 'text')).toEqual([
      { type: 'text', text: '回答' }
    ])
    const body = JSON.parse(String(captured.init?.body)) as {
      generationConfig?: { thinkingConfig?: { thinkingBudget: number } }
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>
    }
    expect(body.generationConfig?.thinkingConfig?.thinkingBudget).toBe(4096)
    expect(body.contents[1].parts[0]).toEqual({ text: '上一轮思考', thought: true })
  })

  it('surfaces API error messages', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: { message: 'api key not valid' } }), { status: 400 })
    const provider = new GeminiProvider({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'bad',
      model: 'gemini',
      fetchImpl
    })
    await expect(
      collect(
        provider.stream(
          { messages: [{ role: 'user', content: 'hi' }] },
          new AbortController().signal
        )
      )
    ).rejects.toThrow(/api key not valid/)
  })
})
