import { describe, expect, it, vi } from 'vitest'
import {
  runSubagent,
  SUBAGENT_ROLE_TOOLS,
  SUBAGENT_ROUND_LIMIT,
  SUBAGENT_ROLES
} from '../../src/main/agent/subagent'
import type {
  ChatProvider,
  ProviderEvent,
  ProviderRequest,
  ToolDefinition,
  ToolExecutionOutcome
} from '../../src/shared/agent'

const definitions: ToolDefinition[] = [
  ...['list_dir', 'read_file', 'search_files', 'get_git_diff', 'web_search'].map((name) => ({
    name,
    description: name,
    parameters: { type: 'object' }
  })),
  ...['edit_file', 'write_file', 'run_command', 'update_plan'].map((name) => ({
    name,
    description: name,
    parameters: { type: 'object' }
  })),
  ...['run_tests', 'run_typecheck', 'run_lint'].map((name) => ({
    name,
    description: name,
    parameters: { type: 'object' }
  })),
  { name: 'delegate_task', description: 'delegate', parameters: { type: 'object' } }
]

function toolCall(id: string, name: string): ProviderEvent {
  return { type: 'tool_call', toolCall: { id, name, argumentsJson: '{}' } }
}

class ScriptedProvider implements ChatProvider {
  readonly requests: ProviderRequest[] = []
  private index = 0

  constructor(private readonly scripts: ProviderEvent[][]) {}

  async *stream(request: ProviderRequest): AsyncGenerator<ProviderEvent> {
    this.requests.push(request)
    const script = this.scripts[this.index] ?? [
      { type: 'text', text: '结论' },
      { type: 'done', finishReason: 'stop' }
    ]
    this.index += 1
    for (const event of script) yield event
  }
}

function baseDeps(provider: ChatProvider, execute = vi.fn(async () => okOutcome())) {
  return {
    resolveProvider: () => provider,
    definitions: () => definitions,
    execute,
    onUsage: vi.fn()
  }
}

function okOutcome(): ToolExecutionOutcome {
  return { ok: true, content: 'ok', summary: 'ok' }
}

function baseInput(overrides: Partial<Parameters<typeof runSubagent>[1]> = {}) {
  return {
    role: 'explore' as const,
    task: '找到入口文件',
    sessionId: 's1',
    runId: 'r1',
    signal: new AbortController().signal,
    ...overrides
  }
}

describe('subagent role tool sets', () => {
  it('defines exactly the three roles with non-overlapping duties', () => {
    expect([...SUBAGENT_ROLES].sort()).toEqual(['explore', 'implement', 'verify'])
    expect(SUBAGENT_ROLE_TOOLS.explore).toContain('search_files')
    expect(SUBAGENT_ROLE_TOOLS.explore).not.toContain('edit_file')
    expect(SUBAGENT_ROLE_TOOLS.implement).toContain('edit_file')
    expect(SUBAGENT_ROLE_TOOLS.implement).not.toContain('run_tests')
    expect(SUBAGENT_ROLE_TOOLS.verify).toContain('run_tests')
    expect(SUBAGENT_ROLE_TOOLS.verify).not.toContain('write_file')
  })

  it('never exposes delegate_task, preventing nested delegation', () => {
    for (const role of SUBAGENT_ROLES) {
      expect(SUBAGENT_ROLE_TOOLS[role]).not.toContain('delegate_task')
    }
  })

  it('keeps subagent round limits below the main multi-file limit', () => {
    for (const role of SUBAGENT_ROLES) {
      expect(SUBAGENT_ROUND_LIMIT[role]).toBeLessThan(30)
    }
  })
})

describe('runSubagent', () => {
  it('reuses the engine loop with a role-filtered tool set', async () => {
    const provider = new ScriptedProvider([
      [toolCall('c1', 'read_file'), { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'text', text: '入口在 src/main.ts' }, { type: 'done', finishReason: 'stop' }]
    ])
    const result = await runSubagent(baseDeps(provider), baseInput())

    expect(result.ok).toBe(true)
    expect(result.content).toContain('入口在 src/main.ts')
    const declared = provider.requests[0]?.tools?.map((tool) => tool.name) ?? []
    expect(declared).toContain('read_file')
    expect(declared).not.toContain('edit_file')
    expect(declared).not.toContain('delegate_task')
  })

  it('passes the task and context into the subagent prompt', async () => {
    const provider = new ScriptedProvider([])
    await runSubagent(baseDeps(provider), baseInput({ task: '修好登录', context: '见 auth.ts' }))
    const userMessage = provider.requests[0]?.messages.find((m) => m.role === 'user')
    expect(userMessage?.content).toContain('修好登录')
    expect(userMessage?.content).toContain('见 auth.ts')
    expect(provider.requests[0]?.messages[0]?.content).toContain('子代理')
  })

  it('denies tools outside the role even if the model calls them', async () => {
    const execute = vi.fn(async () => okOutcome())
    const provider = new ScriptedProvider([
      [toolCall('c1', 'write_file'), { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'text', text: 'done' }, { type: 'done', finishReason: 'stop' }]
    ])
    await runSubagent(baseDeps(provider, execute), baseInput({ role: 'explore' }))

    expect(execute).not.toHaveBeenCalled()
    const toolMessage = provider.requests[1]?.messages.find(
      (m) => m.role === 'tool' && m.toolCallId === 'c1'
    )
    expect(toolMessage?.content).toContain('无权使用工具')
  })

  it('routes internal tool activity to onProgress', async () => {
    const onProgress = vi.fn()
    const provider = new ScriptedProvider([
      [toolCall('c1', 'read_file'), { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'text', text: 'done' }, { type: 'done', finishReason: 'stop' }]
    ])
    await runSubagent(baseDeps(provider), baseInput({ onProgress }))

    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('read_file'))
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('✓'))
  })

  it('reports subagent usage under the parent session', async () => {
    const provider: ChatProvider = {
      async *stream(): AsyncGenerator<ProviderEvent> {
        yield { type: 'usage', usage: { inputTokens: 80, outputTokens: 20 } }
        yield { type: 'text', text: 'ok' }
        yield { type: 'done', finishReason: 'stop' }
      }
    }
    const deps = baseDeps(provider)
    await runSubagent(deps, baseInput())
    expect(deps.onUsage).toHaveBeenCalledWith({ inputTokens: 80, outputTokens: 20 }, 's1')
  })

  it('maps cancellation and pause to a non-ok outcome', async () => {
    const cancelled = await runSubagent(
      baseDeps(new ScriptedProvider([])),
      baseInput({ signal: AbortSignal.abort() })
    )
    expect(cancelled.ok).toBe(false)
    expect(cancelled.summary).toContain('已取消')

    const looping = new ScriptedProvider(
      Array.from({ length: 12 }, () => [
        toolCall('c', 'read_file'),
        { type: 'done', finishReason: 'tool_calls' }
      ] as ProviderEvent[])
    )
    const paused = await runSubagent(
      baseDeps(looping),
      baseInput({ role: 'explore' })
    )
    expect(paused.ok).toBe(false)
    expect(paused.summary).toContain('轮次用尽')
  })

  it('returns a startup failure when the provider cannot be resolved', async () => {
    const result = await runSubagent(
      {
        ...baseDeps(new ScriptedProvider([])),
        resolveProvider: () => {
          throw new Error('未配置模型')
        }
      },
      baseInput()
    )
    expect(result.ok).toBe(false)
    expect(result.content).toContain('未配置模型')
  })

  it('rejects unknown roles', async () => {
    await expect(
      runSubagent(
        baseDeps(new ScriptedProvider([])),
        baseInput({ role: 'hacker' as Parameters<typeof runSubagent>[1]['role'] })
      )
    ).rejects.toThrow('未知的子代理角色')
  })
})
