<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ChatPanel from '../components/ChatPanel.vue'
import ResizeHandle from '../components/ResizeHandle.vue'
import SessionSidebar from '../components/SessionSidebar.vue'
import StatusBar from '../components/StatusBar.vue'
import TitleBar from '../components/TitleBar.vue'
import WorkspacePanel from '../components/WorkspacePanel.vue'
import { useAppCommands } from '../composables/useAppCommands'
import { useChatStore } from '../stores/chat'
import { usePreferencesStore } from '../stores/preferences'
import { useProjectsStore } from '../stores/projects'
import { useProvidersStore } from '../stores/providers'
import { useSessionStore } from '../stores/session'
import {
  SESSION_WIDTH_DEFAULT,
  SESSION_WIDTH_MAX,
  SESSION_WIDTH_MIN,
  WORKSPACE_WIDTH_DEFAULT,
  WORKSPACE_WIDTH_MIN,
  useSettingsStore,
  workspaceWidthMax
} from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'

const workspace = useWorkspaceStore()
const sessions = useSessionStore()
const projects = useProjectsStore()
const chat = useChatStore()
const providers = useProvidersStore()
const preferences = usePreferencesStore()
const settings = useSettingsStore()
const commands = useAppCommands()

const NARROW_WIDTH = 1024
const viewportWidth = ref(window.innerWidth)
const workspaceMax = computed(() => workspaceWidthMax(viewportWidth.value))
let wasNarrow = false

function syncViewport(): void {
  viewportWidth.value = window.innerWidth
  if (settings.workspaceWidth > workspaceMax.value) {
    settings.setWorkspaceWidth(workspaceMax.value)
  }
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
  await providers.refresh()
  await preferences.refresh()
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
      <ResizeHandle
        v-if="!settings.sessionCollapsed"
        side="left"
        :value="settings.sessionWidth"
        :min="SESSION_WIDTH_MIN"
        :max="SESSION_WIDTH_MAX"
        @update="settings.setSessionWidth"
        @reset="settings.setSessionWidth(SESSION_WIDTH_DEFAULT)"
      />

      <main class="conversation">
        <ChatPanel />
      </main>

      <ResizeHandle
        v-if="!settings.workspaceCollapsed"
        side="right"
        :value="settings.workspaceWidth"
        :min="WORKSPACE_WIDTH_MIN"
        :max="workspaceMax"
        @update="settings.setWorkspaceWidth"
        @reset="settings.setWorkspaceWidth(WORKSPACE_WIDTH_DEFAULT)"
      />
      <WorkspacePanel v-if="!settings.workspaceCollapsed" />
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

.error {
  margin: 0;
  padding: 8px 18px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
</style>
