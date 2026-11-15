import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import type { AgentEvent } from '@shared/agent'
import type { ApprovalDecision, ApprovalRequest } from '@shared/approval'
import { ATTACHMENT_LIMITS, type ContextAttachment } from '@shared/attachment'
import {
  attachStepApproval,
  closePendingApprovals,
  resolveStepApproval,
  resolveToolStep,
  settleRunningSteps,
  upsertToolStep,
  type AgentStep
} from '../lib/agentSteps'
import { checkAttachment } from '../lib/attachments'
import { languageForPath } from '../lib/language'
import { useSessionStore } from './session'

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatErrorInfo {
  code?: string
  message: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  streaming?: boolean
  runId?: string
  runStartedAt?: number
  runEndedAt?: number
  steps?: AgentStep[]
  error?: ChatErrorInfo
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const useChatStore = defineStore('chat', () => {
  const sessionStore = useSessionStore()
  const messagesBySession = ref<Record<string, ChatMessage[]>>({})
  const draft = ref('')
  const sending = ref(false)
  const activeRunId = ref<string | null>(null)
  const pendingApprovals = ref<ApprovalRequest[]>([])
  const attachments = ref<ContextAttachment[]>([])
  const attachmentError = ref('')

  let activeSessionId: string | null = null
  let cancelRequested = false
  let activeRunStartedAt = 0

  const messages = computed<ChatMessage[]>(() => {
    const sessionId = sessionStore.activeSessionId
    return sessionId ? (messagesBySession.value[sessionId] ?? []) : []
  })

  function ensureMessages(sessionId: string): ChatMessage[] {
    return messagesBySession.value[sessionId] ?? (messagesBySession.value[sessionId] = [])
  }

  function append(sessionId: string, role: ChatRole, content: string): ChatMessage {
    const message: ChatMessage = { id: createId(), role, content, createdAt: Date.now() }
    ensureMessages(sessionId).push(message)
    return message
  }

  function findOrCreateAssistant(sessionId: string, messageId: string): ChatMessage {
    const list = ensureMessages(sessionId)
    let message = list.find((item) => item.id === messageId)
    if (!message) {
      message = {
        id: messageId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        streaming: true,
        runId: activeRunId.value ?? undefined,
        runStartedAt: activeRunStartedAt || Date.now()
      }
      list.push(message)
    }
    return message
  }

  /** 当前 run 的步骤容器：优先复用本次 run 的助手消息，避免挂到上一轮消息上。 */
  function stepsContainer(sessionId: string, at: number): ChatMessage {
    const list = ensureMessages(sessionId)
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const message = list[index]
      if (message.role === 'assistant' && message.runId && message.runId === activeRunId.value) {
        return message
      }
    }
    const message: ChatMessage = {
      id: createId(),
      role: 'assistant',
      content: '',
      createdAt: at,
      runId: activeRunId.value ?? undefined,
      runStartedAt: activeRunStartedAt || at,
      steps: []
    }
    list.push(message)
    return message
  }

  function findStepMessage(sessionId: string, callId: string): ChatMessage | null {
    return (
      ensureMessages(sessionId).find((message) =>
        message.steps?.some((step) => step.callId === callId)
      ) ?? null
    )
  }

  function findApprovalMessage(sessionId: string, approvalId: string): ChatMessage | null {
    return (
      ensureMessages(sessionId).find((message) =>
        message.steps?.some((step) => step.approval?.approvalId === approvalId)
      ) ?? null
    )
  }

  function appendError(sessionId: string, message: string, code?: string): void {
    ensureMessages(sessionId).push({
      id: createId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      error: { code, message }
    })
  }

  function handleEvent(event: AgentEvent): void {
    if (event.type === 'run:start') {
      if (activeRunId.value && activeRunId.value !== event.runId) return
      activeRunId.value = event.runId
      activeSessionId = event.sessionId
      activeRunStartedAt = event.ts
      return
    }

    if (event.runId !== activeRunId.value || !activeSessionId) return

    switch (event.type) {
      case 'message:delta': {
        const message = findOrCreateAssistant(activeSessionId, event.messageId)
        message.content += event.text
        break
      }
      case 'message:done': {
        const message = findOrCreateAssistant(activeSessionId, event.messageId)
        message.content = event.content
        message.streaming = false
        break
      }
      case 'tool:call': {
        const container = stepsContainer(activeSessionId, event.ts)
        if (!container.steps) container.steps = []
        upsertToolStep(container.steps, {
          callId: event.callId,
          name: event.name,
          argsSummary: event.argsSummary,
          startedAt: event.ts
        })
        break
      }
      case 'tool:result': {
        const message = findStepMessage(activeSessionId, event.callId)
        if (message?.steps) {
          resolveToolStep(message.steps, event.callId, {
            ok: event.ok,
            summary: event.summary,
            endedAt: event.ts
          })
        }
        break
      }
      case 'run:error': {
        const target = stepsContainer(activeSessionId, event.ts)
        target.error = { code: event.code, message: event.message }
        target.runEndedAt = target.runEndedAt ?? event.ts
        if (target.steps) {
          closePendingApprovals(target.steps)
          settleRunningSteps(target.steps, '运行失败', event.ts)
        }
        sending.value = false
        break
      }
      case 'run:done': {
        for (const message of messagesBySession.value[activeSessionId] ?? []) {
          if (message.runId !== activeRunId.value) continue
          if (message.streaming) message.streaming = false
          if (message.runStartedAt && !message.runEndedAt) {
            message.runEndedAt = event.ts
          }
          if (message.steps) {
            closePendingApprovals(message.steps)
            settleRunningSteps(
              message.steps,
              event.reason === 'cancelled' ? '已取消' : '运行结束',
              event.ts
            )
          }
        }
        sending.value = false
        activeRunId.value = null
        activeSessionId = null
        activeRunStartedAt = 0
        cancelRequested = false
        pendingApprovals.value = []
        break
      }
      default:
        break
    }
  }

  // 事件订阅在 store 生命周期内只注册一次
  window.yocim.chat.onEvent(handleEvent)
  window.yocim.approval.onRequest((request) => {
    if (activeSessionId) {
      let message = findStepMessage(activeSessionId, request.callId)
      if (!message) {
        const container = stepsContainer(activeSessionId, Date.now())
        container.steps ??= []
        upsertToolStep(container.steps, {
          callId: request.callId,
          name: request.tool,
          argsSummary: request.argsSummary,
          startedAt: Date.now()
        })
        message = container
      }
      if (message.steps) {
        attachStepApproval(message.steps, {
          approvalId: request.approvalId,
          callId: request.callId,
          risk: request.risk
        })
      }
    }
    if (!pendingApprovals.value.some((item) => item.approvalId === request.approvalId)) {
      pendingApprovals.value.push(request)
    }
  })

  async function respondApproval(approvalId: string, decision: ApprovalDecision): Promise<void> {
    if (activeSessionId) {
      const message = findApprovalMessage(activeSessionId, approvalId)
      if (message?.steps) resolveStepApproval(message.steps, approvalId, decision)
    }
    pendingApprovals.value = pendingApprovals.value.filter((item) => item.approvalId !== approvalId)
    await window.yocim.approval.respond({ approvalId, decision })
  }

  async function loadSession(sessionId: string): Promise<void> {
    const result = await window.yocim.sessions.messages({ sessionId })
    if (!result.ok) return
    messagesBySession.value[sessionId] = result.data.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt
    }))
  }

  function appendSystem(content: string, sessionId?: string): void {
    const target = sessionId ?? sessionStore.activeSessionId
    if (!target) return
    append(target, 'system', content)
  }

  function addAttachment(attachment: ContextAttachment): boolean {
    attachmentError.value = ''
    const check = checkAttachment(attachments.value, attachment)
    if (check === 'duplicate') return true
    if (check === 'count') {
      attachmentError.value = `最多附加 ${ATTACHMENT_LIMITS.maxCount} 个上下文文件`
      return false
    }
    if (check === 'total') {
      attachmentError.value = '上下文附件总大小超出限制'
      return false
    }
    attachments.value.push(attachment)
    return true
  }

  async function attachFile(node: { relativePath: string }): Promise<void> {
    attachmentError.value = ''
    const result = await window.yocim.workspace.readFile({ relativePath: node.relativePath })
    if (!result.ok) {
      attachmentError.value = result.error.message
      return
    }
    const max = ATTACHMENT_LIMITS.maxFileBytes
    const content = result.data.content.slice(0, max)
    addAttachment({
      id: createId(),
      type: 'file',
      relativePath: result.data.relativePath,
      content,
      language: languageForPath(result.data.relativePath),
      truncated: result.data.truncated || result.data.content.length > max
    })
  }

  function removeAttachment(id: string): void {
    attachments.value = attachments.value.filter((item) => item.id !== id)
  }

  function clearAttachments(): void {
    attachments.value = []
    attachmentError.value = ''
  }

  async function send(): Promise<void> {
    const text = draft.value.trim()
    if (!text || sending.value) return

    sending.value = true
    const sessionId = sessionStore.activeSessionId ?? (await sessionStore.createSession())
    if (!sessionId) {
      sending.value = false
      return
    }

    const history = ensureMessages(sessionId)
      .filter((message) => message.role !== 'system' && message.content.trim().length > 0)
      .slice(-50)
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content
      }))

    append(sessionId, 'user', text)
    draft.value = ''
    // IPC 结构化克隆无法序列化 Vue 响应式 Proxy，先转成纯数据
    const pendingAttachments = toRaw(attachments.value).map((item) => ({ ...toRaw(item) }))

    let result: Awaited<ReturnType<typeof window.yocim.chat.send>>
    try {
      result = await window.yocim.chat.send({
        sessionId,
        text,
        history,
        attachments: pendingAttachments
      })
    } catch {
      sending.value = false
      appendError(sessionId, '发送失败：主进程无响应')
      return
    }

    if (!result.ok) {
      sending.value = false
      appendError(sessionId, `发送失败：${result.error.message}`, result.error.code)
      return
    }

    attachments.value = []
    attachmentError.value = ''

    // 运行可能已经被取消或提前结束，此时不再恢复 runId
    if (!sending.value) return
    activeRunId.value = result.data.runId
    activeSessionId = sessionId
    if (cancelRequested) {
      cancelRequested = false
      await window.yocim.chat.cancel({ runId: result.data.runId })
    }
    void sessionStore.refresh()
  }

  async function retry(): Promise<void> {
    if (sending.value) return
    const sessionId = sessionStore.activeSessionId
    if (!sessionId) return
    const lastUser = [...ensureMessages(sessionId)]
      .reverse()
      .find((message) => message.role === 'user' && message.content.trim())
    if (!lastUser) return
    draft.value = lastUser.content
    await send()
  }

  async function cancel(): Promise<void> {
    const runId = activeRunId.value
    if (!runId) {
      // IPC 响应尚未返回时点击取消，记录待取消，runId 就绪后立即生效
      if (sending.value) cancelRequested = true
      return
    }
    await window.yocim.chat.cancel({ runId })
  }

  return {
    messagesBySession,
    messages,
    draft,
    sending,
    activeRunId,
    pendingApprovals,
    attachments,
    attachmentError,
    send,
    retry,
    cancel,
    respondApproval,
    loadSession,
    appendSystem,
    addAttachment,
    attachFile,
    removeAttachment,
    clearAttachments
  }
})
