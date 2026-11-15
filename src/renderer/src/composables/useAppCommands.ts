import { nextTick } from 'vue'
import { useChatStore } from '../stores/chat'
import { useProjectsStore } from '../stores/projects'
import { useSessionStore } from '../stores/session'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'

/**
 * 标题栏菜单、全局快捷键与 rail 共用的应用级命令，避免多处重复会话/工作区逻辑。
 */
export function useAppCommands() {
  const workspace = useWorkspaceStore()
  const sessions = useSessionStore()
  const projects = useProjectsStore()
  const chat = useChatStore()
  const settings = useSettingsStore()

  async function createSession(): Promise<void> {
    settings.setSessionCollapsed(false)
    const projectId = sessions.activeSession?.projectId ?? undefined
    if (projectId) {
      const ok = await workspace.openProject(projectId)
      if (!ok) return
    }
    const id = await sessions.createSession(projectId)
    if (!id) return
    await chat.loadSession(id)
    await projects.refresh()
  }

  async function focusSessionSearch(): Promise<void> {
    settings.setSessionCollapsed(false)
    await nextTick()
    const input = document.querySelector<HTMLInputElement>('[data-testid="session-search"]')
    input?.focus()
    input?.select()
  }

  async function switchWorkspace(): Promise<void> {
    await workspace.select()
    await projects.refresh()
  }

  function toggleSession(): void {
    settings.setSessionCollapsed(!settings.sessionCollapsed)
  }

  function toggleWorkspace(): void {
    settings.setWorkspaceCollapsed(!settings.workspaceCollapsed)
  }

  function toggleStatus(): void {
    settings.setStatusExpanded(!settings.statusExpanded)
  }

  return {
    createSession,
    focusSessionSearch,
    switchWorkspace,
    toggleSession,
    toggleWorkspace,
    toggleStatus
  }
}
