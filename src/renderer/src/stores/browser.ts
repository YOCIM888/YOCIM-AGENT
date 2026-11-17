import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  BrowserAuditEntry,
  BrowserConsoleEntry,
  BrowserControlMode,
  BrowserEvent,
  BrowserExceptionEntry,
  BrowserNetworkEntry,
  BrowserState
} from '@shared/browser'
import { BROWSER_LIMITS } from '@shared/browser'

/**
 * 浏览器 tab 的渲染层状态。所有事件都带 sessionId，写入前按当前会话过滤，
 * 切会话时整体清空，避免串会话 / 串项目。
 */
export const useBrowserStore = defineStore('browser', () => {
  const state = ref<BrowserState | null>(null)
  const consoleEntries = ref<BrowserConsoleEntry[]>([])
  const networkEntries = ref<BrowserNetworkEntry[]>([])
  const exceptions = ref<BrowserExceptionEntry[]>([])
  const auditEntries = ref<BrowserAuditEntry[]>([])
  const urlDraft = ref('')
  const error = ref('')
  let boundSession: string | null = null
  let unsubscribe: (() => void) | null = null

  const status = computed(() => state.value?.status ?? 'idle')
  const mode = computed<BrowserControlMode>(() => state.value?.mode ?? 'ai')
  const headless = computed(() => state.value?.headless ?? false)
  const connected = computed(() => status.value === 'ready')
  const busy = computed(() => status.value === 'connecting' || status.value === 'reconnecting')

  function reset(sessionId: string | null): void {
    boundSession = sessionId
    state.value = null
    consoleEntries.value = []
    networkEntries.value = []
    exceptions.value = []
    auditEntries.value = []
    error.value = ''
  }

  function matches(sessionId: string): boolean {
    return boundSession !== null && sessionId === boundSession
  }

  function applyEvent(event: BrowserEvent): void {
    if (event.type === 'state') {
      if (!matches(event.state.sessionId ?? '')) return
      state.value = event.state
      if (event.state.url && !urlDraft.value) urlDraft.value = event.state.url
      if (event.state.error) error.value = event.state.error
      return
    }
    if (!matches(event.entry.sessionId)) return
    switch (event.type) {
      case 'console':
        consoleEntries.value.unshift(event.entry)
        consoleEntries.value.length = Math.min(
          consoleEntries.value.length,
          BROWSER_LIMITS.maxBufferEntries
        )
        break
      case 'network':
        networkEntries.value.unshift(event.entry)
        networkEntries.value.length = Math.min(
          networkEntries.value.length,
          BROWSER_LIMITS.maxBufferEntries
        )
        break
      case 'exception':
        exceptions.value.unshift(event.entry)
        exceptions.value.length = Math.min(exceptions.value.length, BROWSER_LIMITS.maxBufferEntries)
        break
      case 'audit':
        auditEntries.value.unshift(event.entry)
        auditEntries.value.length = Math.min(auditEntries.value.length, BROWSER_LIMITS.maxAuditQuery)
        break
    }
  }

  function subscribe(): void {
    if (unsubscribe) return
    unsubscribe = window.yocim.browser.onEvent(applyEvent)
  }

  function stop(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  async function loadState(sessionId: string): Promise<void> {
    reset(sessionId)
    subscribe()
    const result = await window.yocim.browser.state({ sessionId })
    if (result.ok) {
      state.value = result.data
      urlDraft.value = result.data.url ?? ''
      error.value = result.data.error ?? ''
    } else {
      error.value = result.error.message
    }
  }

  async function reportViewport(input: {
    sessionId: string
    x: number
    y: number
    width: number
    height: number
    visible: boolean
  }): Promise<void> {
    const result = await window.yocim.browser.viewport(input)
    if (!result.ok) error.value = result.error.message
  }

  async function navigate(sessionId: string, url: string): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.browser.navigate({ sessionId, url })
    if (result.ok) {
      urlDraft.value = result.data.url
      return true
    }
    error.value = result.error.message
    return false
  }

  async function control(sessionId: string, next: BrowserControlMode): Promise<void> {
    const result = await window.yocim.browser.control({ sessionId, mode: next })
    if (result.ok) state.value = result.data
    else error.value = result.error.message
  }

  async function retry(sessionId: string): Promise<void> {
    error.value = ''
    const result = await window.yocim.browser.retry({ sessionId })
    if (result.ok) state.value = result.data
    else error.value = result.error.message
  }

  async function loadAudit(sessionId: string, limit = 100): Promise<void> {
    const result = await window.yocim.browser.audit({ sessionId, limit })
    if (result.ok) auditEntries.value = [...result.data].reverse()
    else error.value = result.error.message
  }

  return {
    state,
    status,
    mode,
    headless,
    connected,
    busy,
    consoleEntries,
    networkEntries,
    exceptions,
    auditEntries,
    urlDraft,
    error,
    loadState,
    reportViewport,
    navigate,
    control,
    retry,
    loadAudit,
    applyEvent,
    subscribe,
    stop,
    reset
  }
})
