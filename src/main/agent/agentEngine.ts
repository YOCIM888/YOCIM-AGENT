import type {
  AgentEvent,
  AgentMessage,
  AgentRunInput,
  AgentRunResult,
  AgentToolRuntime,
  ChatProvider,
  ProviderFinishReason,
  ToolCall,
  ToolExecutionOutcome
} from '../../shared/agent'

export interface AgentEngineConfig {
  provider: ChatProvider
  systemPrompt?: string
  tools?: AgentToolRuntime
  emit: (event: AgentEvent) => void
}

const MAX_TOOL_ROUNDS = 6

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export function buildMessages(
  systemPrompt: string | undefined,
  history: AgentMessage[],
  userText: string
): AgentMessage[] {
  const messages: AgentMessage[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push(...history)
  messages.push({ role: 'user', content: userText })
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
  const messages = buildMessages(config.systemPrompt, input.history, input.userText)

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

  emit({ type: 'run:start', ...nextMeta(), sessionId: input.sessionId })

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const messageId = `msg-${input.runId.slice(0, 8)}-${round}`
    let roundText = ''
    let finishReason: ProviderFinishReason = 'stop'
    const calls: ToolCall[] = []

    try {
      for await (const chunk of config.provider.stream(
        { messages, tools: config.tools?.definitions },
        signal
      )) {
        if (signal.aborted) break
        if (chunk.type === 'text') {
          roundText += chunk.text
          emit({ type: 'message:delta', ...nextMeta(), messageId, text: chunk.text })
        } else if (chunk.type === 'tool_call') {
          calls.push(chunk.toolCall)
        } else {
          finishReason = chunk.finishReason
        }
      }
    } catch (error) {
      if (roundText) {
        appendRoundText(roundText)
        emit({ type: 'message:done', ...nextMeta(), messageId, content: roundText })
      }
      if (signal.aborted) {
        finish('cancelled')
        return { text: combinedText, reason: 'cancelled' }
      }
      finish('error', { code: 'E_PROVIDER', message: describeError(error) })
      return { text: combinedText, reason: 'error' }
    }

    if (signal.aborted) {
      if (roundText) {
        appendRoundText(roundText)
        emit({ type: 'message:done', ...nextMeta(), messageId, content: roundText })
      }
      finish('cancelled')
      return { text: combinedText, reason: 'cancelled' }
    }

    if (roundText) {
      appendRoundText(roundText)
      emit({ type: 'message:done', ...nextMeta(), messageId, content: roundText })
    }

    if (calls.length === 0) {
      if (finishReason === 'tool_calls') {
        finish('error', { code: 'E_TOOL_UNSUPPORTED', message: '模型请求了无法解析的工具调用' })
        return { text: combinedText, reason: 'error' }
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
          argsSummary: truncate(call.argumentsJson, 500)
        })
      }
      finish('error', { code: 'E_TOOL_UNSUPPORTED', message: '当前未启用工具系统' })
      return { text: combinedText, reason: 'error' }
    }

    messages.push({ role: 'assistant', content: roundText, toolCalls: calls })

    for (const call of calls) {
      if (signal.aborted) break
      emit({
        type: 'tool:call',
        ...nextMeta(),
        callId: call.id,
        name: call.name,
        argsSummary: truncate(call.argumentsJson, 500)
      })

      let outcome: ToolExecutionOutcome
      try {
        outcome = await config.tools.execute(call, signal)
      } catch (error) {
        outcome = {
          ok: false,
          content: `工具执行失败：${describeError(error)}`,
          summary: '工具执行失败'
        }
      }

      emit({
        type: 'tool:result',
        ...nextMeta(),
        callId: call.id,
        ok: outcome.ok,
        summary: outcome.summary
      })
      messages.push({ role: 'tool', toolCallId: call.id, content: outcome.content })
    }

    if (signal.aborted) {
      finish('cancelled')
      return { text: combinedText, reason: 'cancelled' }
    }
  }

  finish('error', { code: 'E_TOOL_LIMIT', message: '工具执行轮次超过上限' })
  return { text: combinedText, reason: 'error' }
}
