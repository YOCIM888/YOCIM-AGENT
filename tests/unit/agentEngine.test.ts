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
