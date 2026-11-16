import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ApprovalManager } from '../../src/main/approval/approvalManager'
import { AuditStore } from '../../src/main/audit/auditStore'
import { runAgentTurn, type AgentEngineConfig } from '../../src/main/agent/agentEngine'
import { ToolService } from '../../src/main/tools/toolService'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'
import type {
  AgentEvent,
  ChatProvider,
  ProviderEvent,
  ProviderRequest,
  ToolDefinition
} from '../../src/shared/agent'
import { TOOL_DEFINITIONS, isWriteTool } from '../../src/shared/tools'
import type { ToolFileIo } from '../../src/main/tools/toolFileIo'

/**
 * 基准集 harness（P5）：
 * - ScriptedProvider 回放固定决策序列，验证「工具链」的正确性与效率；
 *   真实 provider 的能力评测是手动流程（T5.3），不进 CI。
 * - 指标：成功率 / 轮次 / 工具调用数 / 耗时 / 审批次数 / 上下文峰值 / 误改率。
 * - 回归门禁（T5.4）由 bench.test.ts 对比 results/baseline.json 实现。
 */

export class ScriptedProvider implements ChatProvider {
  readonly requests: ProviderRequest[] = []
  roundsUsed = 0
  private index = 0

  constructor(private readonly scripts: ProviderEvent[][]) {}

  async *stream(request: ProviderRequest): AsyncGenerator<ProviderEvent> {
    this.requests.push(request)
    this.roundsUsed += 1
    const script = this.scripts[this.index] ?? []
    this.index += 1
    if (!script.length) {
      yield { type: 'done', finishReason: 'stop' }
      return
    }
    for (const event of script) {
      yield event
    }
  }
}

export interface BenchMetrics {
  success: boolean
  rounds: number
  toolCalls: number
  durationMs: number
  approvals: number
  contextPeakTokens: number
  filesTouched: string[]
  /** 改动了 allowedFiles 之外的文件（误改率判定），拒绝类任务可为空 */
  unexpectedFiles: string[]
}

export interface BenchTask {
  id: string
  name: string
  difficulty: 'easy' | 'medium' | 'hard'
  maxRounds: number
  maxToolCalls: number
  /** 初始化 fixture 工作区（临时目录） */
  setup: (root: string) => Promise<void>
  /** 模型决策序列（每轮一个 ProviderEvent 数组） */
  script: ProviderEvent[][]
  /** 本任务允许修改的文件（误改率判定；空数组 = 不检查） */
  allowedFiles: string[]
  /** true = 任务目标就是「操作被拒绝」，工具失败不算任务失败 */
  expectDeny?: boolean
  /** 自定义文件访问实现（远程一致性任务注入内存 io 模拟 SSH SFTP 接缝） */
  fileIo?: () => ToolFileIo
  /** 真实工具链验证：不通过抛错即任务失败 */
  verify: (ctx: BenchVerifyContext) => void | Promise<void>
}

export interface BenchVerifyContext {
  root: string
  provider: ScriptedProvider
  events: AgentEvent[]
  metrics: BenchMetrics
  audit: AuditStore
  workspaceRoot: string
}

function toolCall(
  id: string,
  name: string,
  args: Record<string, unknown>
): { type: 'tool_call'; toolCall: { id: string; name: string; argumentsJson: string } } {
  return { type: 'tool_call', toolCall: { id, name, argumentsJson: JSON.stringify(args) } }
}

export const call = toolCall

/** 收尾轮：输出一段文本后正常结束 */
export const finish = (text: string): ProviderEvent[] => [
  { type: 'text', text },
  { type: 'done', finishReason: 'stop' }
]

export interface BenchRunResult {
  task: BenchTask
  metrics: BenchMetrics
  error?: string
}

export async function runBenchTask(task: BenchTask): Promise<BenchRunResult> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yocim-bench-'))
  const events: AgentEvent[] = []
  const startedAt = Date.now()

  try {
    await task.setup(root)
    const guard = await WorkspacePathGuard.create(root)
    const audit = new AuditStore()
    const requests: { approvalId: string }[] = []
    const approvals = new ApprovalManager((request) => {
      requests.push(request)
      // 自动批准：bench 关注工具链与效率，人工审批语义由单元/e2e 覆盖
      approvals.respond(request.approvalId, 'approve')
    })
    const provider = new ScriptedProvider(task.script)
    const service = new ToolService({
      approvals,
      audit,
      requireGuard: () => guard,
      getApprovalMode: () => 'open',
      fileIo: task.fileIo?.()
    })
    const tools = {
      definitions: TOOL_DEFINITIONS as ToolDefinition[],
      execute: (call: { id: string; name: string; argumentsJson: string }, signal: AbortSignal) =>
        service.execute(call, { sessionId: 'bench', runId: 'bench-run', signal })
    }

    const config: AgentEngineConfig = {
      provider,
      systemPrompt: '你是编码助手。（bench 回放：system prompt 固定）',
      tools,
      emit: (event) => events.push(event)
    }

    const outcome = await runAgentTurn(
      config,
      {
        runId: 'bench-run',
        sessionId: 'bench',
        history: [],
        userText: task.name
      },
      new AbortController().signal
    )

    // 指标采集
    const toolCalls = events.filter((event) => event.type === 'tool:call').length
    const approvalsCount = requests.length
    let contextPeakTokens = 0
    for (const event of events) {
      if (event.type === 'context:usage') {
        contextPeakTokens = Math.max(contextPeakTokens, event.usage.used)
      }
    }
    const filesTouched: string[] = []
    for (const event of events) {
      if (event.type !== 'tool:call' || !isWriteTool(event.name)) continue
      const callEvent = event as Extract<AgentEvent, { type: 'tool:call' }>
      // 从原始脚本里找回参数（argsSummary 不含路径细节）
      const scriptCall = task.script
        .flat()
        .filter((item) => item.type === 'tool_call')
        .map((item) => (item as ReturnType<typeof toolCall>).toolCall)
        .find((item) => item.id === callEvent.callId)
      if (!scriptCall) continue
      try {
        const parsed = JSON.parse(scriptCall.argumentsJson) as { relativePath?: unknown }
        if (typeof parsed.relativePath === 'string' && parsed.relativePath) {
          filesTouched.push(parsed.relativePath)
        }
      } catch {
        // 参数解析失败不影响其他指标
      }
    }
    const unexpectedFiles = task.allowedFiles.length
      ? [...new Set(filesTouched)].filter((file) => !task.allowedFiles.includes(file))
      : []

    const metrics: BenchMetrics = {
      success: true,
      rounds: provider.roundsUsed,
      toolCalls,
      durationMs: Date.now() - startedAt,
      approvals: approvalsCount,
      contextPeakTokens,
      filesTouched: [...new Set(filesTouched)],
      unexpectedFiles
    }

    let error: string | undefined
    try {
      await task.verify({
        root,
        provider,
        events,
        metrics,
        audit,
        workspaceRoot: root
      })
    } catch (verifyError) {
      error = verifyError instanceof Error ? verifyError.message : String(verifyError)
    }
    // 非拒绝类任务：run 以错误收尾也算失败
    if (!task.expectDeny && outcome.reason === 'error' && !error) {
      error = `run 以错误收尾（最后文本：${outcome.text.slice(0, 120)}）`
    }
    if (task.expectDeny) {
      metrics.success = error === undefined
    } else {
      metrics.success =
        error === undefined &&
        metrics.unexpectedFiles.length === 0 &&
        metrics.rounds <= task.maxRounds &&
        metrics.toolCalls <= task.maxToolCalls
    }
    return { task, metrics, error }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
