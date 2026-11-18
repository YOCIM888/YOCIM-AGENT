import { describe, expect, it, vi } from 'vitest'
import { buildMessages, runAgentTurn } from '../../src/main/agent/agentEngine'
import { MockProvider } from '../../src/main/agent/providers/mockProvider'
import type {
  AgentEvent,
  ChatProvider,
  ProviderEvent,
  ProviderRequest
} from '../../src/shared/agent'

const baseInput = {
  runId: 'run-1',
  sessionId: 'session-1',
  history: [],
  userText: '你好'
}

class SlowProvider implements ChatProvider {
  async *stream(_request: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    yield { type: 'text', text: 'first' }
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (signal.aborted) return
    yield { type: 'text', text: 'second' }
    yield { type: 'done', finishReason: 'stop' }
  }
}

class ThrowingProvider implements ChatProvider {
  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<ProviderEvent> {
    throw new Error('boom')
  }
}

class ToolCallProvider implements ChatProvider {
  async *stream(): AsyncGenerator<ProviderEvent> {
    yield {
      type: 'tool_call',
      toolCall: { id: 'call-1', name: 'read_file', argumentsJson: '{"path":"a.txt"}' }
    }
    yield { type: 'done', finishReason: 'tool_calls' }
  }
}

class ScriptedProvider implements ChatProvider {
  readonly requests: ProviderRequest[] = []
  private index = 0

  constructor(private readonly scripts: ProviderEvent[][]) {}

  async *stream(request: ProviderRequest): AsyncGenerator<ProviderEvent> {
    this.requests.push(request)
    const script = this.scripts[this.index] ?? [{ type: 'done', finishReason: 'stop' }]
    this.index += 1
    for (const event of script) {
      yield event
    }
  }
}

describe('buildMessages', () => {
  it('puts system prompt first, then history, then the new user message', () => {
    const messages = buildMessages(
      'system prompt',
      [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' }
      ],
      'c'
    )
    expect(messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' }
    ])
  })

  it('omits the system message when no prompt is provided', () => {
    expect(buildMessages(undefined, [], 'c')).toEqual([{ role: 'user', content: 'c' }])
  })

  it('appends attachment context to the user message', () => {
    const messages = buildMessages(undefined, [], '请解释', [
      {
        id: 'a1',
        type: 'file',
        relativePath: 'src/a.ts',
        language: 'typescript',
        content: 'export const a = 1'
      },
      {
        id: 'a2',
        type: 'selection',
        relativePath: 'src/b.ts',
        content: 'const b = 2',
        range: { startLine: 3, startColumn: 1, endLine: 5, endColumn: 1 },
        truncated: true
      }
    ])
    const user = messages[messages.length - 1]
    expect(user.role).toBe('user')
    expect(user.content.startsWith('请解释\n\n')).toBe(true)
    expect(user.content).toContain('### src/a.ts')
    expect(user.content).toContain('```typescript\nexport const a = 1\n```')
    expect(user.content).toContain('### src/b.ts（第 3-5 行）')
    expect(user.content).toContain('（内容已截断）')
  })

  it('leaves the user message unchanged when attachments are empty', () => {
    expect(buildMessages(undefined, [], 'c', [])).toEqual([{ role: 'user', content: 'c' }])
  })
})

describe('runAgentTurn', () => {
  it('streams deltas and completes with a single terminal event', async () => {
    const events: AgentEvent[] = []
    const result = await runAgentTurn(
      {
        provider: new MockProvider({ delayMs: 0 }),
        systemPrompt: 'sys',
        emit: (event) => events.push(event)
      },
      baseInput,
      new AbortController().signal
    )

    expect(result.reason).toBe('completed')
    expect(events[0]).toMatchObject({ type: 'run:start', sessionId: 'session-1' })

    const deltas = events.filter((event) => event.type === 'message:delta')
    const doneMessage = events.find((event) => event.type === 'message:done')
    expect(deltas.length).toBeGreaterThan(1)
    expect(result.text).toContain('Mock Provider 已收到：你好')
    expect(doneMessage).toMatchObject({ type: 'message:done', content: result.text })

    const terminalEvents = events.filter((event) => event.type === 'run:done')
    expect(terminalEvents).toHaveLength(1)
    expect(terminalEvents[0]).toMatchObject({ reason: 'completed' })

    const sequences = events.map((event) => event.seq)
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
    expect(new Set(sequences).size).toBe(sequences.length)
  })

  it('stops streaming after cancellation and emits cancelled', async () => {
    const events: AgentEvent[] = []
    const controller = new AbortController()
    let resolveFirstDelta: () => void = () => undefined
    const firstDelta = new Promise<void>((resolve) => {
      resolveFirstDelta = resolve
    })

    const run = runAgentTurn(
      {
        provider: new SlowProvider(),
        emit: (event) => {
          events.push(event)
          if (event.type === 'message:delta') resolveFirstDelta()
        }
      },
      baseInput,
      controller.signal
    )

    await firstDelta
    controller.abort()
    const result = await run

    expect(result.reason).toBe('cancelled')
    expect(events[events.length - 1]).toMatchObject({ type: 'run:done', reason: 'cancelled' })
    expect(events.some((event) => event.type === 'message:delta' && event.text === 'second')).toBe(
      false
    )
    expect(events.filter((event) => event.type === 'run:done')).toHaveLength(1)
  })

  it('maps provider failures to run:error and a single error terminal', async () => {
    const events: AgentEvent[] = []
    const result = await runAgentTurn(
      {
        provider: new ThrowingProvider(),
        emit: (event) => events.push(event)
      },
      baseInput,
      new AbortController().signal
    )

    expect(result.reason).toBe('error')
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'run:error', code: 'E_PROVIDER', message: 'boom' })
    )
    expect(events[events.length - 1]).toMatchObject({ type: 'run:done', reason: 'error' })
  })

  it('keeps hidden reasoning on the assistant message across tool rounds', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'reasoning', text: '先列目录' },
        {
          type: 'tool_call',
          toolCall: { id: 'call-1', name: 'list_dir', argumentsJson: '{}' }
        },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [
        { type: 'text', text: '完成' },
        { type: 'done', finishReason: 'stop' }
      ]
    ])
    const appended: Array<{ role: string; reasoningContent?: string }> = []

    await runAgentTurn(
      {
        provider,
        emit: () => {},
        tools: {
          definitions: [],
          execute: async () => ({ ok: true, content: 'a.txt', summary: 'a.txt' })
        },
        onAppend: (messages) => appended.push(...messages)
      },
      baseInput,
      new AbortController().signal
    )

    expect(provider.requests[1].messages).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        reasoningContent: '先列目录',
        toolCalls: [expect.objectContaining({ id: 'call-1' })]
      })
    )
    expect(appended[0]).toMatchObject({ role: 'assistant', reasoningContent: '先列目录' })
  })

  it('streams reasoning deltas to the UI and finalizes them with message:done', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'reasoning', text: '先' },
        { type: 'reasoning', text: '分析' },
        { type: 'text', text: '答案' },
        { type: 'done', finishReason: 'stop' }
      ]
    ])
    const events: AgentEvent[] = []

    await runAgentTurn(
      { provider, emit: (event) => events.push(event) },
      baseInput,
      new AbortController().signal
    )

    const reasoning = events.flatMap((event) =>
      event.type === 'reasoning:delta' ? [{ messageId: event.messageId, text: event.text }] : []
    )
    expect(reasoning).toEqual([
      { messageId: 'msg-run-1-0', text: '先' },
      { messageId: 'msg-run-1-0', text: '分析' }
    ])
    expect(events.find((event) => event.type === 'message:done')).toMatchObject({
      type: 'message:done',
      content: '答案',
      reasoning: '先分析'
    })
  })

  it('reports unsupported tool calls until the tool system lands', async () => {
    const events: AgentEvent[] = []
    const result = await runAgentTurn(
      {
        provider: new ToolCallProvider(),
        emit: (event) => events.push(event)
      },
      baseInput,
      new AbortController().signal
    )

    expect(result.reason).toBe('error')
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool:call', callId: 'call-1', name: 'read_file' })
    )
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'run:error', code: 'E_TOOL_UNSUPPORTED' })
    )
  })

  it('executes tools, feeds results back to the provider and completes', async () => {
    const provider = new ScriptedProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'call-1', name: 'read_file', argumentsJson: '{"relativePath":"a.txt"}' }
        },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [
        { type: 'text', text: '读取成功' },
        { type: 'done', finishReason: 'stop' }
      ]
    ])
    const execute = vi.fn(async () => ({
      ok: true,
      content: 'file-content',
      summary: 'a.txt'
    }))
    const events: AgentEvent[] = []

    const result = await runAgentTurn(
      {
        provider,
        emit: (event) => events.push(event),
        tools: { definitions: [], execute }
      },
      baseInput,
      new AbortController().signal
    )

    expect(execute).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool:result', callId: 'call-1', ok: true })
    )
    expect(result).toMatchObject({ reason: 'completed', text: '读取成功' })

    const secondRequest = provider.requests[1]
    expect(
      secondRequest.messages.some(
        (message) => message.role === 'assistant' && message.toolCalls?.[0]?.id === 'call-1'
      )
    ).toBe(true)
    expect(
      secondRequest.messages.some(
        (message) =>
          message.role === 'tool' &&
          message.toolCallId === 'call-1' &&
          message.content === 'file-content'
      )
    ).toBe(true)
  })
})

describe('runAgentTurn round and tool gating', () => {
  it('uses toolsForRound to change the declared tools per round', async () => {
    const provider = new ScriptedProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'c1', name: 'read_file', argumentsJson: '{"relativePath":"a.ts"}' }
        },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [
        { type: 'text', text: 'done' },
        { type: 'done', finishReason: 'stop' }
      ]
    ])
    const tools = {
      definitions: [
        { name: 'read_file', description: 'r', parameters: { type: 'object' } },
        { name: 'delegate_task', description: 'd', parameters: { type: 'object' } }
      ],
      execute: async () => ({ ok: true, content: 'x', summary: 'x' })
    }

    await runAgentTurn(
      {
        provider,
        tools,
        toolsForRound: (round) =>
          round === 0
            ? tools.definitions.filter((definition) => definition.name !== 'delegate_task')
            : tools.definitions,
        emit: () => {}
      },
      baseInput,
      new AbortController().signal
    )

    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(['read_file'])
    expect(provider.requests[1]?.tools?.map((tool) => tool.name)).toEqual([
      'read_file',
      'delegate_task'
    ])
  })

  it('honors a fixed roundLimit and pauses instead of erroring', async () => {
    const events: AgentEvent[] = []
    const provider = new ScriptedProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'c1', name: 'read_file', argumentsJson: '{"relativePath":"a.ts"}' }
        },
        { type: 'done', finishReason: 'tool_calls' }
      ],
      [
        { type: 'text', text: 'should not run' },
        { type: 'done', finishReason: 'stop' }
      ]
    ])

    const result = await runAgentTurn(
      {
        provider,
        tools: { definitions: [], execute: async () => ({ ok: true, content: '', summary: '' }) },
        roundLimit: 1,
        emit: (event) => events.push(event)
      },
      baseInput,
      new AbortController().signal
    )

    expect(result.reason).toBe('paused')
    expect(provider.requests).toHaveLength(1)
    expect(events.some((event) => event.type === 'run:paused')).toBe(true)
    expect(events.some((event) => event.type === 'run:error')).toBe(false)
  })

  it('treats command-based writes as multi-file so they are not capped at 20 rounds', async () => {
    const provider = new ScriptedProvider(
      Array.from(
        { length: 21 },
        () =>
          [
            {
              type: 'tool_call',
              toolCall: {
                id: 'c1',
                name: 'run_command',
                argumentsJson: '{"command":"git apply patch"}'
              }
            },
            { type: 'done', finishReason: 'tool_calls' }
          ] as ProviderEvent[]
      )
    )

    const result = await runAgentTurn(
      {
        provider,
        tools: { definitions: [], execute: async () => ({ ok: true, content: '', summary: '' }) },
        emit: () => {}
      },
      baseInput,
      new AbortController().signal
    )

    expect(provider.requests).toHaveLength(22)
    expect(result.reason).not.toBe('paused')
  })
})

describe('runAgentTurn usage reporting', () => {
  it('reports the token usage of each round', async () => {
    const onUsage = vi.fn()
    const provider: ChatProvider = {
      async *stream(): AsyncGenerator<ProviderEvent> {
        yield { type: 'text', text: 'hi' }
        yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 30 } }
        yield { type: 'done', finishReason: 'stop' }
      }
    }

    await runAgentTurn(
      { provider, emit: () => {}, onUsage },
      baseInput,
      new AbortController().signal
    )

    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 120, outputTokens: 30 })
  })

  it('still reports usage when the provider throws mid-stream', async () => {
    const onUsage = vi.fn()
    const provider: ChatProvider = {
      async *stream(): AsyncGenerator<ProviderEvent> {
        yield { type: 'usage', usage: { inputTokens: 50, outputTokens: 10 } }
        throw new Error('boom')
      }
    }

    await runAgentTurn(
      { provider, emit: () => {}, onUsage },
      baseInput,
      new AbortController().signal
    )

    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 50, outputTokens: 10 })
  })
})
