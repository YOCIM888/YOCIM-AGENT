import type { ContextAttachment } from './attachment'
import type { ContextUsage } from './context'

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
  /**
   * OpenAI 兼容 Provider 的隐藏思考内容（DeepSeek 等）。
   * 带工具调用时必须原样回传，否则后续请求会被 Provider 拒绝（HTTP 400）。
   */
  reasoningContent?: string
}

export interface ToolExecutionOutcome {
  ok: boolean
  content: string
  summary: string
  /** 工具产出的图片 URL（生图工具用），供 UI 直接渲染 */
  images?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ProviderFinishReason = 'stop' | 'tool_calls' | 'length'

/** 单次模型调用的 token 用量 */
export interface ProviderUsage {
  inputTokens: number
  outputTokens: number
}

export type ProviderEvent =
  | { type: 'text'; text: string }
  /** 思考内容既随助手消息回传 Provider，也以折叠块流式展示在 UI */
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'usage'; usage: ProviderUsage }
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

export type AgentRunDoneReason = 'completed' | 'cancelled' | 'error' | 'paused'

/** 计划条目状态：pending 未开始 / doing 进行中 / done 已完成 */
export type PlanItemStatus = 'pending' | 'doing' | 'done'

export interface PlanItem {
  step: string
  status: PlanItemStatus
}

interface AgentEventBase {
  runId: string
  seq: number
  ts: number
}

export type AgentEvent =
  | (AgentEventBase & { type: 'run:start'; sessionId: string })
  | (AgentEventBase & { type: 'message:delta'; messageId: string; text: string })
  /** 思考链流式增量：与该轮的 messageId 绑定，渲染层挂在同一个助手消息上 */
  | (AgentEventBase & { type: 'reasoning:delta'; messageId: string; text: string })
  | (AgentEventBase & {
      type: 'message:done'
      messageId: string
      content: string
      /** 本轮完整的思考内容（用于精确覆盖累积值 + 落库） */
      reasoning?: string
    })
  | (AgentEventBase & { type: 'tool:call'; callId: string; name: string; argsSummary: string })
  | (AgentEventBase & {
      type: 'tool:output'
      callId: string
      /** 节流合并后的增量输出文本（命令执行等长任务） */
      text: string
    })
  | (AgentEventBase & {
      type: 'tool:result'
      callId: string
      ok: boolean
      summary: string
      /** 生图等工具产出的图片 URL，UI 据此渲染缩略图 */
      images?: string[]
    })
  | (AgentEventBase & { type: 'run:error'; code: string; message: string })
  | (AgentEventBase & {
      type: 'run:paused'
      sessionId: string
      /** 暂停原因：round_limit 轮次用尽（可继续） */
      reason: 'round_limit'
      rounds: number
    })
  | (AgentEventBase & { type: 'run:done'; reason: AgentRunDoneReason })
  | (AgentEventBase & { type: 'context:usage'; sessionId: string; usage: ContextUsage })
  | (AgentEventBase & {
      type: 'context:compacted'
      sessionId: string
      reason: 'auto' | 'manual'
      /** 压缩前估算 token */
      before: number
      /** 压缩后估算 token */
      after: number
      /** 被压缩掉的条目数 */
      dropped: number
      /** 摘要预览（用于在会话里提示） */
      summary: string
      usage: ContextUsage
    })
  | (AgentEventBase & {
      type: 'plan:updated'
      sessionId: string
      plan: PlanItem[]
    })

export interface AgentRunInput {
  runId: string
  sessionId: string
  history: AgentMessage[]
  userText: string
  attachments?: ContextAttachment[]
  /**
   * 预组装好的完整请求消息（含 system）：提供时忽略 history/userText/attachments。
   * 用于上下文管理器直出请求，保证压缩与用量估算用的是同一份数据。
   */
  prebuiltMessages?: AgentMessage[]
}

export interface AgentRunResult {
  text: string
  reason: AgentRunDoneReason
}
