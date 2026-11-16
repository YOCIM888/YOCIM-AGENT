import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runAgentTurn, type AgentEngineConfig } from '../../src/main/agent/agentEngine'
import { PlanStore } from '../../src/main/agent/planStore'
import { migrate } from '../../src/main/db/database'
import { AgentPlanRepository, SessionRepository } from '../../src/main/db/repositories'
import { summarizeToolArgs } from '../../src/shared/tools'
import { runUpdatePlan } from '../../src/main/tools/planTools'
import type {
  AgentEvent,
  AgentToolRuntime,
  ChatProvider,
  ProviderEvent,
  ToolCall,
  ToolExecutionOutcome
} from '../../src/shared/agent'

const baseInput = {
  runId: 'run-1',
  sessionId: 'session-1',
  history: [],
  userText: '做多文件任务'
}

/** 每轮请求一个工具调用，脚本结束后正常收尾 */
class LoopedToolProvider implements ChatProvider {
  private round = 0
  constructor(private readonly call: (round: number) => ToolCall) {}

  async *stream(): AsyncGenerator<ProviderEvent> {
    this.round += 1
    yield { type: 'tool_call', toolCall: this.call(this.round) }
    yield { type: 'done', finishReason: 'tool_calls' }
  }
}

function runtime(execute: (call: ToolCall) => Promise<ToolExecutionOutcome>): AgentToolRuntime {
  return {
    definitions: [],
    execute: (call) => execute(call)
  }
}

function collect(events: AgentEvent[], type: AgentEvent['type']): AgentEvent[] {
  return events.filter((event) => event.type === type)
}

function toolResults(events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'tool:result' }>> {
  return events.filter(
    (event): event is Extract<AgentEvent, { type: 'tool:result' }> => event.type === 'tool:result'
  )
}

describe('轮次上限分级', () => {
  it('read-only runs pause after 6 rounds instead of erroring', async () => {
    const events: AgentEvent[] = []
    let executed = 0
    const provider = new LoopedToolProvider((round) => ({
      id: `c${round}`,
      name: 'read_file',
      argumentsJson: '{"relativePath":"a.txt"}'
    }))
    const config: AgentEngineConfig = {
      provider,
      emit: (event) => events.push(event),
      tools: runtime(async () => {
        executed += 1
        return { ok: true, content: 'ok', summary: 'ok' }
      })
    }
    const result = await runAgentTurn(config, baseInput, new AbortController().signal)
    expect(executed).toBe(6)
    expect(result.reason).toBe('paused')
    const paused = collect(events, 'run:paused').at(-1) as Extract<
      AgentEvent,
      { type: 'run:paused' }
    >
    expect(paused.reason).toBe('round_limit')
    expect(paused.rounds).toBe(6)
    const done = collect(events, 'run:done').at(-1) as Extract<AgentEvent, { type: 'run:done' }>
    expect(done.reason).toBe('paused')
    expect(collect(events, 'run:error')).toHaveLength(0)
  })

  it('a write tool raises the cap: run survives beyond round 6', async () => {
    const events: AgentEvent[] = []
    let executed = 0
    const provider = new LoopedToolProvider((round) => ({
      id: `c${round}`,
      name: 'edit_file',
      argumentsJson: '{"relativePath":"a.ts"}'
    }))
    const config: AgentEngineConfig = {
      provider,
      emit: (event) => events.push(event),
      tools: runtime(async () => {
        executed += 1
        return { ok: true, content: 'ok', summary: 'ok' }
      })
    }
    await runAgentTurn(config, baseInput, new AbortController().signal)
    expect(executed).toBe(20)
  })

  it('writes across multiple files raise the cap to 60', async () => {
    let executed = 0
    const provider = new LoopedToolProvider((round) => ({
      id: `c${round}`,
      name: round % 2 === 0 ? 'write_file' : 'edit_file',
      // 交替写两个不同文件
      argumentsJson: `{"relativePath":"${round % 2 === 0 ? 'a.ts' : 'b.ts'}"}`
    }))
    const config: AgentEngineConfig = {
      provider,
      emit: () => undefined,
      tools: runtime(async () => {
        executed += 1
        return { ok: true, content: 'ok', summary: 'ok' }
      })
    }
    const result = await runAgentTurn(config, baseInput, new AbortController().signal)
    expect(executed).toBe(60)
    expect(result.reason).toBe('paused')
  })
})

describe('只读工具并发', () => {
  it('runs read-only calls concurrently (max 4) and keeps results in call order', async () => {
    const events: AgentEvent[] = []
    let inFlight = 0
    let maxInFlight = 0
    const calls: ToolCall[] = [0, 1, 2, 3, 4].map((index) => ({
      id: `c${index}`,
      name: 'search_files',
      argumentsJson: `{"query":"q${index}"}`
    }))

    // 第 0 轮发 5 个只读调用，第 1 轮收尾
    class BatchProvider implements ChatProvider {
      private round = 0
      async *stream(): AsyncGenerator<ProviderEvent> {
        this.round += 1
        if (this.round === 1) {
          for (const call of calls) yield { type: 'tool_call', toolCall: call }
          yield { type: 'done', finishReason: 'tool_calls' }
        } else {
          yield { type: 'done', finishReason: 'stop' }
        }
      }
    }

    const config: AgentEngineConfig = {
      provider: new BatchProvider(),
      emit: (event) => events.push(event),
      tools: runtime(async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 30))
        inFlight -= 1
        return { ok: true, content: 'done', summary: 'done' }
      })
    }
    await runAgentTurn(config, baseInput, new AbortController().signal)

    // 5 个调用并发执行，上限 4
    expect(maxInFlight).toBe(4)
    const results = toolResults(events)
    expect(results).toHaveLength(5)
    // 结果按调用顺序回填（协议一致性）
    expect(results.map((event) => event.callId)).toEqual(calls.map((call) => call.id))
  })
})

function createStore(): { store: PlanStore; db: DatabaseSync; sessionId: string } {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  // agent_plan.session_id 外键关联 sessions，需要先建会话
  const session = new SessionRepository(db).create({
    title: 't',
    workspaceRoot: null,
    projectId: null
  })
  const store = new PlanStore({ repo: new AgentPlanRepository(db) })
  return { store, db, sessionId: session.id }
}

describe('PlanStore', () => {
  it('stores, reads and renders a plan', () => {
    const { store, db, sessionId } = createStore()
    expect(store.get(sessionId)).toEqual([])
    store.set(sessionId, [
      { step: '读代码', status: 'done' },
      { step: '改实现', status: 'doing' },
      { step: '跑测试', status: 'pending' }
    ])
    expect(store.renderForPrompt(sessionId)).toBe('[x] 读代码\n[~] 改实现\n[ ] 跑测试')
    // 跨实例（重启）恢复
    const second = new PlanStore({ repo: new AgentPlanRepository(db) })
    expect(second.get(sessionId)).toHaveLength(3)
    db.close()
  })

  it('ignores invalid persisted plans', () => {
    const { db, sessionId } = createStore()
    const repo = new AgentPlanRepository(db)
    repo.set(sessionId, [{ step: '', status: 'weird' }])
    const store = new PlanStore({ repo })
    expect(store.get(sessionId)).toEqual([])
    db.close()
  })
})

describe('update_plan 工具', () => {
  it('writes through PlanStore and reports counts', async () => {
    const { store, sessionId } = createStore()
    const outcome = await runUpdatePlan(store, sessionId, {
      plan: [
        { step: '改 A 文件', status: 'done' },
        { step: '改 B 文件', status: 'doing' },
        { step: '跑测试', status: 'pending' }
      ]
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('1 完成、1 进行中')
    expect(store.get(sessionId)).toHaveLength(3)
  })

  it('renders a one-line summary without exposing full steps', () => {
    const summary = summarizeToolArgs(
      'update_plan',
      JSON.stringify({
        plan: [
          { step: 'a'.repeat(120), status: 'done' },
          { step: 'b', status: 'doing' }
        ]
      })
    )
    expect(summary).toBe('update_plan（2 步，1 进行中）')
  })
})
