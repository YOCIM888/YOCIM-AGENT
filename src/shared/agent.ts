export type AgentRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  argumentsJson: string
}

export interface AgentMessage {
  role: AgentRole
  content: string
  toolCallId?: string
  toolCalls?: ToolCall[]
}

export interface ToolExecutionOutcome {
  ok: boolean
  content: string
  summary: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ProviderFinishReason = 'stop' | 'tool_calls' | 'length'

export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done'; finishReason: ProviderFinishReason }

export interface ProviderRequest {
  messages: AgentMessage[]
  tools?: ToolDefinition[]
}

export interface ChatProvider {
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
}

export interface AgentToolRuntime {
  definitions: ToolDefinition[]
  execute(call: ToolCall, signal: AbortSignal): Promise<ToolExecutionOutcome>
}

export type AgentRunDoneReason = 'completed' | 'cancelled' | 'error'

interface AgentEventBase {
  runId: string
  seq: number
  ts: number
}

export type AgentEvent =
  | (AgentEventBase & { type: 'run:start'; sessionId: string })
  | (AgentEventBase & { type: 'message:delta'; messageId: string; text: string })
  | (AgentEventBase & { type: 'message:done'; messageId: string; content: string })
  | (AgentEventBase & { type: 'tool:call'; callId: string; name: string; argsSummary: string })
  | (AgentEventBase & { type: 'tool:result'; callId: string; ok: boolean; summary: string })
  | (AgentEventBase & { type: 'run:error'; code: string; message: string })
  | (AgentEventBase & { type: 'run:done'; reason: AgentRunDoneReason })

export interface AgentRunInput {
  runId: string
  sessionId: string
  history: AgentMessage[]
  userText: string
}

export interface AgentRunResult {
  text: string
  reason: AgentRunDoneReason
}
