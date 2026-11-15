import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { SessionSummary } from '@shared/session'
import { useProjectsStore } from './projects'

export const useSessionStore = defineStore('session', () => {
  const projects = useProjectsStore()
  const sessions = ref<SessionSummary[]>([])
  const activeSessionId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref('')

  const activeSession = computed(
    () => sessions.value.find((session) => session.id === activeSessionId.value) ?? null
  )

  async function fetchList(): Promise<void> {
    const result = await window.yocim.sessions.list({ includeArchived: true })
    if (result.ok) {
      sessions.value = result.data
    } else {
      error.value = result.error.message
    }
  }

  async function init(): Promise<void> {
    loading.value = true
    try {
      await fetchList()
      if (
        !activeSessionId.value ||
        !sessions.value.some((session) => session.id === activeSessionId.value)
      ) {
        activeSessionId.value = sessions.value.find((session) => !session.archivedAt)?.id ?? null
      }
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    const active = activeSessionId.value
    await fetchList()
    if (active && sessions.value.some((session) => session.id === active)) {
      activeSessionId.value = active
    } else {
      activeSessionId.value = sessions.value.find((session) => !session.archivedAt)?.id ?? null
    }
    await projects.refresh()
  }

  async function createSession(projectId?: string): Promise<string | null> {
    error.value = ''
    const result = await window.yocim.sessions.create(projectId ? { projectId } : {})
    if (!result.ok) {
      error.value = result.error.message
      return null
    }
    sessions.value.unshift(result.data)
    activeSessionId.value = result.data.id
    await projects.refresh()
    return result.data.id
  }

  async function renameSession(sessionId: string, title: string): Promise<boolean> {
    const result = await window.yocim.sessions.rename({ sessionId, title })
    if (!result.ok) {
      error.value = result.error.message
      return false
    }
    replace(result.data)
    return true
  }

  async function pinSession(sessionId: string, pinned: boolean): Promise<boolean> {
    const result = await window.yocim.sessions.pin({ sessionId, pinned })
    if (!result.ok) {
      error.value = result.error.message
      return false
    }
    replace(result.data)
    await refresh()
    return true
  }

  async function archiveSession(sessionId: string, archived: boolean): Promise<boolean> {
    const result = await window.yocim.sessions.archive({ sessionId, archived })
    if (!result.ok) {
      error.value = result.error.message
      return false
    }
    replace(result.data)
    await refresh()
    await projects.refresh()
    return true
  }

  async function moveSession(sessionId: string, projectId: string): Promise<boolean> {
    const result = await window.yocim.sessions.move({ sessionId, projectId })
    if (!result.ok) {
      error.value = result.error.message
      return false
    }
    replace(result.data)
    await refresh()
    await projects.refresh()
    return true
  }

  async function removeSession(sessionId: string): Promise<string | null> {
    const result = await window.yocim.sessions.remove({ sessionId })
    if (!result.ok) {
      error.value = result.error.message
      return activeSessionId.value
    }
    sessions.value = sessions.value.filter((session) => session.id !== sessionId)
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value.find((session) => !session.archivedAt)?.id ?? null
    }
    await projects.refresh()
    return activeSessionId.value
  }

  function replace(session: SessionSummary): void {
    const index = sessions.value.findIndex((item) => item.id === session.id)
    if (index >= 0) {
      sessions.value[index] = session
    } else {
      sessions.value.unshift(session)
    }
  }

  function selectSession(sessionId: string): void {
    if (sessions.value.some((session) => session.id === sessionId)) {
      activeSessionId.value = sessionId
    }
  }

  function clearError(): void {
    error.value = ''
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    loading,
    error,
    init,
    refresh,
    createSession,
    renameSession,
    pinSession,
    archiveSession,
    moveSession,
    removeSession,
    selectSession,
    clearError
  }
})
