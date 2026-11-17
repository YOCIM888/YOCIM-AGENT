<script setup lang="ts">
import { computed } from 'vue'
import { useProjectsStore } from '../stores/projects'
import { useSessionStore } from '../stores/session'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore } from '../stores/workspace'

const ui = useUiStore()
const sessions = useSessionStore()
const projects = useProjectsStore()
const workspace = useWorkspaceStore()

/** 当前项目优先取活动会话，其次按工作区根目录匹配；两者都没有时禁用约定入口。 */
const currentProjectId = computed(
  () =>
    sessions.activeSession?.projectId ??
    projects.projects.find((project) => project.root === workspace.info?.root)?.id ??
    null
)
</script>

<template>
  <nav class="sidebar-toolbar" aria-label="侧边栏工具条" data-testid="sidebar-toolbar">
    <button
      type="button"
      class="tool-button"
      :class="{ active: ui.terminalOpen }"
      data-testid="sidebar-tool-terminal"
      title="终端"
      aria-label="终端"
      :aria-pressed="ui.terminalOpen"
      @click="ui.toggleTerminal()"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
        <rect
          x="1.75"
          y="2.75"
          width="12.5"
          height="10.5"
          rx="2"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <path
          d="m4.5 6 2 2-2 2M8.5 10.5h3"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <button
      type="button"
      class="tool-button"
      :class="{ active: ui.conventionsOpen }"
      data-testid="sidebar-tool-conventions"
      :title="currentProjectId ? '项目约定' : '请先打开一个项目'"
      aria-label="项目约定"
      :aria-pressed="ui.conventionsOpen"
      :disabled="!currentProjectId"
      @click="ui.toggleConventions()"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
        <path
          d="M4 2.25h5.5L13 5.75v8H4z"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
        <path
          d="M9.25 2.5v3.5H13M6 9h4.5M6 11.25h4.5"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
    </button>

    <button
      type="button"
      class="tool-button placeholder"
      data-testid="sidebar-tool-browser"
      title="浏览器（占位）"
      aria-label="浏览器（占位）"
      aria-disabled="true"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.3" />
        <path
          d="M2.4 8h11.2M8 2.25c1.6 1.8 2.4 3.6 2.4 5.75S9.6 12 8 13.75C6.4 12 5.6 10.2 5.6 8S6.4 4.05 8 2.25z"
          stroke="currentColor"
          stroke-width="1.3"
        />
      </svg>
    </button>

    <button
      type="button"
      class="tool-button"
      data-testid="sidebar-tool-settings"
      title="设置"
      aria-label="设置"
      @click="ui.openSettings()"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
        <path
          d="M6.7 1.9h2.6l.35 1.75c.5.18.96.45 1.38.8l1.7-.6 1.3 2.25-1.3 1.2c.06.3.09.6.09.9s-.03.6-.09.9l1.3 1.2-1.3 2.25-1.7-.6c-.42.35-.88.62-1.38.8L9.3 14.1H6.7l-.35-1.75c-.5-.18-.96-.45-1.38-.8l-1.7.6-1.3-2.25 1.3-1.2a5.9 5.9 0 0 1 0-1.8l-1.3-1.2L3.27 3l1.7.6c.42-.35.88-.62 1.38-.8z"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linejoin="round"
        />
        <circle cx="8" cy="8" r="2.05" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </button>
  </nav>
</template>

<style scoped>
.sidebar-toolbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 5px 8px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
}

.tool-button {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    color 120ms ease;
}

.tool-button:hover {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.tool-button.active {
  border-color: var(--border);
  background: var(--accent-soft);
  color: var(--accent);
}

.tool-button:disabled {
  color: var(--text-muted);
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
