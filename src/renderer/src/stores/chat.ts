import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import type { AgentEvent, PlanItem } from '@shared/agent'
import type { ApprovalDecision, ApprovalRequest } from '@shared/approval'
import {
  ATTACHMENT_LIMITS,
  type ContextAttachment,
  type ContextAttachmentRange
} from '@shared/attachment'
import { type ContextHint, type ContextUsage } from '@shared/context'
import {
  attachStepApproval,
  appendStepOutput,
  closePendingApprovals,
  resolveStepApproval,
  resolveToolStep,
  settleRunningSteps,
  upsertToolStep,
  type AgentStep
} from '../lib/agentSteps'
import { checkAttachment, createSelectionAttachment } from '../lib/attachments'
import { languageForPath } from '../lib/language'
import { useWorkspaceStore } from './workspace'
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
  const workspaceStore = useWorkspaceStore()
  const messagesBySession = ref<Record<string, ChatMessage[]>>({})
  const draft = ref('')
  const sending = ref(false)
  const activeRunId = ref<string | null>(null)
  const pendingApprovals = ref<ApprovalRequest[]>([])
  const attachments = ref<ContextAttachment[]>([])
  const attachmentError = ref('')
  const usageBySession = ref<Record<string, ContextUsage>>({})
  const compressing = ref(false)
  const compressError = ref('')
  const planBySession = ref<Record<string, PlanItem[]>>({})
  const pausedBySession = ref<Record<string, boolean>>({})

  let activeSessionId: string | null = null
  let cancelRequested = false
  let activeRunStartedAt = 0

  /** 当前会话的上下文用量（圆环数据源） */
  const contextUsage = computed<ContextUsage | null>(() => {
    const sessionId = sessionStore.activeSessionId
    if (!sessionId) return null
    return usageBySession.value[sessionId] ?? null
  })

  const messages = computed<ChatMessage[]>(() => {
    const sessionId = sessionStore.activeSessionId
    return sessionId ? (messagesBySession.value[sessionId] ?? []) : []
  })

  /** 当前会话的计划（计划卡数据源） */
  const plan = computed<PlanItem[]>(() => {
    const sessionId = sessionStore.activeSessionId
    return sessionId ? (planBySession.value[sessionId] ?? []) : []
  })

  /** 当前会话是否处于「轮次用尽已暂停」状态 */
  const paused = computed<boolean>(() => {
    const sessionId = sessionStore.activeSessionId
    return sessionId ? (pausedBySession.value[sessionId] ?? false) : false
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

    // 上下文事件不绑定具体 run（手动压缩发生在运行之外），先于 runId 校验处理
    if (event.type === 'context:usage') {
      usageBySession.value = { ...usageBySession.value, [event.sessionId]: event.usage }
      return
    }
    if (event.type === 'context:compacted') {
      usageBySession.value = { ...usageBySession.value, [event.sessionId]: event.usage }
      const label =
        event.reason === 'auto'
          ? `上下文接近上限，已自动压缩：${event.dropped} 条旧内容并入摘要`
          : `已手动压缩上下文：${event.dropped} 条旧内容并入摘要`
      append(event.sessionId, 'system', label)
      return
    }
    // 计划更新不绑定具体 run（会话切换后计划卡仍要刷新）
    if (event.type === 'plan:updated') {
      planBySession.value = { ...planBySession.value, [event.sessionId]: event.plan }
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
      case 'tool:output': {
        const message = findStepMessage(activeSessionId, event.callId)
        const step = message?.steps?.find((item) => item.callId === event.callId)
        if (step) appendStepOutput(step, event.text)
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
              event.reason === 'cancelled'
                ? '已取消'
                : event.reason === 'paused'
                  ? '已暂停'
                  : '运行结束',
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
      case 'run:paused': {
        pausedBySession.value = { ...pausedBySession.value, [event.sessionId]: true }
        append(
          activeSessionId,
          'system',
          `已连续执行 ${event.rounds} 轮工具，任务已暂停。确认当前进展后点击「继续」接着做。`
        )
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
    void refreshUsage(sessionId)
    // 计划卡跨重启恢复
    const planResult = await window.yocim.chat.getPlan({ sessionId })
    if (planResult.ok) {
      planBySession.value = { ...planBySession.value, [sessionId]: planResult.data }
    }
  }

  /** 拉取会话的上下文用量（圆环数据源；运行中则由事件推送更新） */
  async function refreshUsage(sessionId: string): Promise<void> {
    const result = await window.yocim.chat.contextUsage({ sessionId })
    if (!result.ok) return
    usageBySession.value = { ...usageBySession.value, [sessionId]: result.data }
  }

  /** 切换上下文窗口后按当前会话刷新用量 */
  async function refreshActiveUsage(): Promise<void> {
    const sessionId = sessionStore.activeSessionId
    if (sessionId) await refreshUsage(sessionId)
  }

  /** 手动压缩：点击用量圆环触发 */
  async function compress(): Promise<void> {
    const sessionId = sessionStore.activeSessionId
    if (!sessionId || compressing.value || sending.value) return
    compressing.value = true
    compressError.value = ''
    try {
      const result = await window.yocim.chat.compress({ sessionId })
      if (result.ok) {
        usageBySession.value = { ...usageBySession.value, [sessionId]: result.data.usage }
        if (!result.data.compacted) {
          append(sessionId, 'system', result.data.message)
        }
      } else {
        compressError.value = result.error.message
        appendError(sessionId, `压缩失败：${result.error.message}`, result.error.code)
      }
    } catch {
      compressError.value = '压缩失败：主进程无响应'
    } finally {
      compressing.value = false
    }
  }

  /** 当前处境提示：正在看的文件与未保存的文件，随请求带给主进程注入 prompt */
  function buildContextHint(): ContextHint {
    const hint: ContextHint = {}
    if (workspaceStore.activeFile) hint.activeFile = workspaceStore.activeFile.relativePath
    const dirty = workspaceStore.tabs
      .filter((tab) => tab.content !== tab.savedContent)
      .map((tab) => tab.relativePath)
      .slice(0, 20)
    if (dirty.length) hint.dirtyFiles = dirty
    return hint
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

  /** 编辑器选区右键 / 头部按钮：无选区时退化为整文件附件。 */
  function attachSelection(input: {
    relativePath: string
    content: string
    range: ContextAttachmentRange
  }): boolean {
    return addAttachment(
      createSelectionAttachment({
        id: createId(),
        relativePath: input.relativePath,
        content: input.content,
        language: languageForPath(input.relativePath),
        range: input.range
      })
    )
  }

  function removeAttachment(id: string): void {
    attachments.value = attachments.value.filter((item) => item.id !== id)
  }

  function clearAttachments(): void {
    attachments.value = []
    attachmentError.value = ''
  }

  async function send(textArg?: string): Promise<void> {
    const text = (textArg ?? draft.value).trim()
    if (!text || sending.value) return

    sending.value = true
    const sessionId = sessionStore.activeSessionId ?? (await sessionStore.createSession())
    if (textArg === undefined) draft.value = ''
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
    // IPC 结构化克隆无法序列化 Vue 响应式 Proxy，先转成纯数据
    const pendingAttachments = toRaw(attachments.value).map((item) => ({ ...toRaw(item) }))

    let result: Awaited<ReturnType<typeof window.yocim.chat.send>>
    try {
      result = await window.yocim.chat.send({
        sessionId,
        text,
        history,
        attachments: pendingAttachments,
        contextHint: buildContextHint()
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

  /** 轮次暂停后继续：发送固定指令，上下文在 DB 里完整回放 */
  async function continuePlan(): Promise<void> {
    const sessionId = sessionStore.activeSessionId
    if (!sessionId || !pausedBySession.value[sessionId] || sending.value) return
    pausedBySession.value = { ...pausedBySession.value, [sessionId]: false }
    await send('继续：从上一步往下接着做，完成后按计划推进直至全部结束。')
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
    contextUsage,
    compressing,
    compressError,
    plan,
    paused,
    send,
    retry,
    cancel,
    compress,
    refreshUsage,
    refreshActiveUsage,
    continuePlan,
    respondApproval,
    loadSession,
    appendSystem,
    addAttachment,
    attachFile,
    attachSelection,
    removeAttachment,
    clearAttachments
  }
})
