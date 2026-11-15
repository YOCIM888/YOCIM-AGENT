<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import ChatPanel from '../components/ChatPanel.vue'
import SessionSidebar from '../components/SessionSidebar.vue'
import StatusBar from '../components/StatusBar.vue'
import TitleBar from '../components/TitleBar.vue'
import WorkspacePanel from '../components/WorkspacePanel.vue'
import { useAppCommands } from '../composables/useAppCommands'
import { useChatStore } from '../stores/chat'
import { useProjectsStore } from '../stores/projects'
import { useSessionStore } from '../stores/session'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'

const workspace = useWorkspaceStore()
const sessions = useSessionStore()
const projects = useProjectsStore()
const chat = useChatStore()
const settings = useSettingsStore()
const commands = useAppCommands()

const NARROW_WIDTH = 1024
let wasNarrow = false

function syncViewport(): void {
  const narrow = window.innerWidth < NARROW_WIDTH
  if (narrow && !wasNarrow) {
    settings.setWorkspaceCollapsed(true)
  }
  wasNarrow = narrow
}

function handleKeydown(event: KeyboardEvent): void {
  if (!event.ctrlKey && !event.metaKey) return
  if (event.altKey) return

  const key = event.key.toLowerCase()
  if (key === 'b') {
    event.preventDefault()
    if (event.shiftKey) {
      commands.toggleWorkspace()
    } else {
      commands.toggleSession()
    }
    return
  }
  if (event.shiftKey) return

  if (key === 'n') {
    event.preventDefault()
    void commands.createSession()
    return
  }
  if (key === 'k') {
    event.preventDefault()
    void commands.focusSessionSearch()
    return
  }
  if (key === 'j') {
    event.preventDefault()
    commands.toggleStatus()
  }
}

async function bootstrap(): Promise<void> {
  await workspace.restore()
  await projects.refresh()
  await sessions.init()
  const active = sessions.activeSession
  if (active?.projectId && active.workspaceRoot !== workspace.info?.root) {
    await workspace.openProject(active.projectId)
  }
  if (sessions.activeSessionId) {
    await chat.loadSession(sessions.activeSessionId)
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', syncViewport)
  syncViewport()
  void bootstrap()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', syncViewport)
})
</script>

<template>
  <div class="app-shell">
    <TitleBar />

    <p v-if="workspace.error" class="error" data-testid="error-banner">{{ workspace.error }}</p>

    <div class="shell-body">
      <SessionSidebar v-if="!settings.sessionCollapsed" />

      <main class="conversation">
        <ChatPanel />
      </main>

      <WorkspacePanel v-if="!settings.workspaceCollapsed" />

      <nav v-else class="rail right-rail" aria-label="工作区快捷栏">
        <button
          type="button"
          class="rail-button"
          data-testid="workspace-expand"
          title="展开工作区 (Ctrl+Shift+B)"
          @click="settings.setWorkspaceCollapsed(false)"
        >
          ‹
        </button>
      </nav>
    </div>

    <StatusBar />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.shell-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.conversation {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.rail {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 46px;
  padding: 10px 0;
  background: var(--bg-subtle);
}

.right-rail {
  border-left: 1px solid var(--border);
}

.rail-button {
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
}

.rail-button:hover {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.error {
  margin: 0;
  padding: 8px 18px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
</style>
