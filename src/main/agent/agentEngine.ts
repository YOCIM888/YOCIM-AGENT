import type {
  AgentEvent,
  AgentMessage,
  AgentRunInput,
  AgentRunResult,
  AgentToolRuntime,
  ChatProvider,
  ProviderFinishReason,
  ProviderUsage,
  ToolCall,
  ToolDefinition,
  ToolExecutionOutcome
} from '../../shared/agent'
import type { ContextAttachment } from '../../shared/attachment'
import { isReadOnlyTool, isWriteTool, summarizeToolArgs } from '../../shared/tools'

export interface AgentEngineConfig {
  provider: ChatProvider
  systemPrompt?: string
  tools?: AgentToolRuntime
  emit: (event: AgentEvent) => void
  /**
   * 每轮把新产生的 assistant（含工具调用）/ tool 消息回传给调用方，
   * 用于持久化上下文流；不提供则调用方只拿最终文本。
   */
  onAppend?: (messages: AgentMessage[]) => void
  /**
   * 每轮请求前给调用方一次调整上下文的机会（典型用途：超阈值时自动压缩）。
   * 返回的数组将替换本轮及后续轮次使用的消息列表。
   */
  beforeRound?: (messages: AgentMessage[]) => Promise<AgentMessage[]>
  /**
   * 每轮结束时上报本轮 token 用量（账单统计用）。
   * 即使随后被取消，已经产生的用量也会被上报。
   */
  onUsage?: (usage: ProviderUsage) => void
  /**
   * 每轮请求前决定暴露给模型的工具定义（只影响声明，不影响执行）。
   * 典型用途：长任务到一定轮次后才暴露 delegate_task。返回 undefined 用默认定义。
   */
  toolsForRound?: (round: number) => ToolDefinition[] | undefined
  /**
   * 固定轮次上限；提供时覆盖基于工作量的自适应上限（子代理用，限制嵌套任务规模）。
   */
  roundLimit?: number
}

/** 轮次上限分级：按本次 run 内的实际工作量自适应，而不是预先分类 */
const ROUND_LIMIT_READ_ONLY = 6
const ROUND_LIMIT_WITH_WRITES = 20
const ROUND_LIMIT_MULTI_FILE = 60
/** 只读工具并发执行上限 */
const READ_ONLY_CONCURRENCY = 4

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

function formatAttachmentContext(attachments: ContextAttachment[]): string {
  const blocks = attachments.map((attachment) => {
    const header = attachment.range
      ? `${attachment.relativePath}（第 ${attachment.range.startLine}-${attachment.range.endLine} 行）`
      : attachment.relativePath
    const language = attachment.language ?? ''
    const note = attachment.truncated ? '\n（内容已截断）' : ''
    return `### ${header}\n\`\`\`${language}\n${attachment.content}\n\`\`\`${note}`
  })
  return `以下是用户附加的上下文文件，仅供参考：\n\n${blocks.join('\n\n')}`
}

export function buildMessages(
  systemPrompt: string | undefined,
  history: AgentMessage[],
  userText: string,
  attachments?: ContextAttachment[]
): AgentMessage[] {
  const messages: AgentMessage[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push(...history)
  const content =
    attachments && attachments.length > 0
      ? `${userText}\n\n${formatAttachmentContext(attachments)}`
      : userText
  messages.push({ role: 'user', content })
  return messages
}

/**
 * 单轮 Agent 执行：组装上下文、消费 Provider 流、执行工具并回填结果，
 * 按 runId + seq 推送事件。该函数不依赖 Electron，且不会抛出异常。
 */
export async function runAgentTurn(
  config: AgentEngineConfig,
  input: AgentRunInput,
  signal: AbortSignal
): Promise<AgentRunResult> {
  let seq = 0
  let finished = false
  let combinedText = ''
  let messages = input.prebuiltMessages
    ? [...input.prebuiltMessages]
    : buildMessages(config.systemPrompt, input.history, input.userText, input.attachments)

  const nextMeta = (): { runId: string; seq: number; ts: number } => ({
    runId: input.runId,
    seq: ++seq,
    ts: Date.now()
  })

  const emit = (event: AgentEvent): void => {
    if (finished) return
    config.emit(event)
  }

  const finish = (
    reason: AgentRunResult['reason'],
    error?: { code: string; message: string }
  ): void => {
    if (finished) return
    if (error) {
      config.emit({ type: 'run:error', ...nextMeta(), code: error.code, message: error.message })
    }
    finished = true
    config.emit({ type: 'run:done', ...nextMeta(), reason })
  }

  const appendRoundText = (roundText: string): void => {
    combinedText = combinedText ? `${combinedText}\n${roundText}` : roundText
  }

  /** 自适应轮次上限：只读问答 6；出现写操作 20；写操作跨多个文件 60 */
  let writeToolsUsed = 0
  const writtenFiles = new Set<string>()
  /** run_command 可一次改动任意多个文件，无法从 relativePath 统计，单独记录 */
  let commandWriteUsed = false
  const roundLimit = (): number => {
    if (writeToolsUsed === 0) return ROUND_LIMIT_READ_ONLY
    if (writtenFiles.size >= 2 || commandWriteUsed) return ROUND_LIMIT_MULTI_FILE
    return ROUND_LIMIT_WITH_WRITES
  }
  const observeCall = (call: ToolCall): void => {
    if (!isWriteTool(call.name)) return
    writeToolsUsed += 1
    if (call.name === 'run_command') {
      // sed / python / git apply 等命令没有 relativePath，按「可能多文件」放宽到 60 轮档，
      // 避免这类任务被永久卡在 20 轮（多文件档只影响上限，不会强迫跑满）。
      commandWriteUsed = true
      return
    }
    try {
      const parsed = JSON.parse(call.argumentsJson) as { relativePath?: unknown }
      if (typeof parsed?.relativePath === 'string' && parsed.relativePath) {
        writtenFiles.add(parsed.relativePath)
      }
    } catch {
      // 参数解析失败不影响轮次上限估算
    }
  }

  emit({ type: 'run:start', ...nextMeta(), sessionId: input.sessionId })

  for (let round = 0; ; round += 1) {
    const currentRoundLimit = config.roundLimit ?? roundLimit()
    if (round >= currentRoundLimit) {
      emit({
        type: 'run:paused',
        ...nextMeta(),
        sessionId: input.sessionId,
        reason: 'round_limit',
        rounds: round
      })
      finish('paused')
      return { text: combinedText, reason: 'paused' }
    }
    if (config.beforeRound) {
      try {
        messages = await config.beforeRound(messages)
      } catch {
        // 压缩失败不应中断运行：沿用现有上下文继续
      }
    }
    const messageId = `msg-${input.runId.slice(0, 8)}-${round}`
    let roundText = ''
    let roundReasoning = ''
    let roundReasoningSignature = ''
    const reasoningSuffix = (): { reasoningContent?: string; reasoningSignature?: string } => ({
      ...(roundReasoning ? { reasoningContent: roundReasoning } : {}),
      ...(roundReasoningSignature ? { reasoningSignature: roundReasoningSignature } : {})
    })
    /** 收口本轮助手消息：只有正文或思考内容至少一样时才推 message:done */
    const finishRoundMessage = (): void => {
      if (!roundText && !roundReasoning) return
      if (roundText) appendRoundText(roundText)
      emit({
        type: 'message:done',
        ...nextMeta(),
        messageId,
        content: roundText,
        ...(roundReasoning ? { reasoning: roundReasoning } : {})
      })
    }
    let finishReason: ProviderFinishReason = 'stop'
    const calls: ToolCall[] = []
    const roundUsage: ProviderUsage = { inputTokens: 0, outputTokens: 0 }

    try {
      const roundDefinitions = config.toolsForRound?.(round) ?? config.tools?.definitions
      for await (const chunk of config.provider.stream(
        { messages, tools: roundDefinitions },
        signal
      )) {
        if (signal.aborted) break
        if (chunk.type === 'text') {
          roundText += chunk.text
          emit({ type: 'message:delta', ...nextMeta(), messageId, text: chunk.text })
        } else if (chunk.type === 'reasoning') {
          // 思考内容既要随助手消息回传 Provider（避免 400），也要流式推给 UI 展示。
          roundReasoning += chunk.text
          emit({ type: 'reasoning:delta', ...nextMeta(), messageId, text: chunk.text })
        } else if (chunk.type === 'reasoning_signature') {
          // Anthropic 的 thinking 签名不展示给用户，但必须随助手消息原样回传。
          roundReasoningSignature += chunk.signature
        } else if (chunk.type === 'tool_call') {
          calls.push(chunk.toolCall)
        } else if (chunk.type === 'usage') {
          roundUsage.inputTokens += chunk.usage.inputTokens
          roundUsage.outputTokens += chunk.usage.outputTokens
        } else {
          finishReason = chunk.finishReason
        }
      }
    } catch (error) {
      finishRoundMessage()
      if (signal.aborted) {
        finish('cancelled')
        return { text: combinedText, reason: 'cancelled' }
      }
      finish('error', { code: 'E_PROVIDER', message: describeError(error) })
      return { text: combinedText, reason: 'error' }
    } finally {
      // 用量上报放在 finally：即使本轮报错或被取消，已产生的 token 也要计入账单
      if (roundUsage.inputTokens > 0 || roundUsage.outputTokens > 0) {
        config.onUsage?.(roundUsage)
      }
    }

    if (signal.aborted) {
      finishRoundMessage()
      finish('cancelled')
      return { text: combinedText, reason: 'cancelled' }
    }

    finishRoundMessage()

    if (calls.length === 0) {
      if (finishReason === 'tool_calls') {
        finish('error', { code: 'E_TOOL_UNSUPPORTED', message: '模型请求了无法解析的工具调用' })
        return { text: combinedText, reason: 'error' }
      }
      if (roundText || roundReasoning) {
        config.onAppend?.([{ role: 'assistant', content: roundText, ...reasoningSuffix() }])
      }
      finish('completed')
      return { text: combinedText, reason: 'completed' }
    }

    if (!config.tools) {
      for (const call of calls) {
        emit({
          type: 'tool:call',
          ...nextMeta(),
          callId: call.id,
          name: call.name,
          argsSummary: summarizeToolArgs(call.name, call.argumentsJson)
        })
      }
      finish('error', { code: 'E_TOOL_UNSUPPORTED', message: '当前未启用工具系统' })
      return { text: combinedText, reason: 'error' }
    }

    const appended: AgentMessage[] = [
      { role: 'assistant', content: roundText, toolCalls: calls, ...reasoningSuffix() }
    ]
    messages.push(appended[0])
    const toolRuntime = config.tools

    const executeCall = async (call: ToolCall): Promise<ToolExecutionOutcome> => {
      try {
        return await toolRuntime.execute(call, signal)
      } catch (error) {
        return {
          ok: false,
          content: `工具执行失败：${describeError(error)}`,
          summary: '工具执行失败'
        }
      }
    }

    for (const call of calls) {
      if (signal.aborted) break
      observeCall(call)
      emit({
        type: 'tool:call',
        ...nextMeta(),
        callId: call.id,
        name: call.name,
        argsSummary: summarizeToolArgs(call.name, call.argumentsJson)
      })
    }

    const outcomes = new Map<string, ToolExecutionOutcome>()
    const readOnly = calls.filter((call) => isReadOnlyTool(call.name))
    const serial = calls.filter((call) => !isReadOnlyTool(call.name))

    // 只读工具并发执行（上限 4）：结果之间无顺序依赖
    let cursor = 0
    const workers = Array.from(
      { length: Math.min(READ_ONLY_CONCURRENCY, readOnly.length) },
      async () => {
        while (cursor < readOnly.length && !signal.aborted) {
          const call = readOnly[cursor]
          cursor += 1
          outcomes.set(call.id, await executeCall(call))
        }
      }
    )
    await Promise.all(workers)

    // 写工具与命令保持串行：有状态依赖与审批顺序
    for (const call of serial) {
      if (signal.aborted) break
      outcomes.set(call.id, await executeCall(call))
    }

    // tool:result 与 tool 消息按调用顺序回填，保持模型侧协议一致
    for (const call of calls) {
      const outcome = outcomes.get(call.id)
      if (!outcome) continue
      emit({
        type: 'tool:result',
        ...nextMeta(),
        callId: call.id,
        ok: outcome.ok,
        summary: outcome.summary,
        images: outcome.images
      })
      const toolMessage: AgentMessage = {
        role: 'tool',
        toolCallId: call.id,
        content: outcome.content
      }
      appended.push(toolMessage)
      messages.push(toolMessage)
    }

    if (appended.length) config.onAppend?.(appended)

    if (signal.aborted) {
      finish('cancelled')
      return { text: combinedText, reason: 'cancelled' }
    }
  }
}
