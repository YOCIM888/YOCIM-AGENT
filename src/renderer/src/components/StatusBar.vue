<script setup lang="ts">
import { computed } from 'vue'
import { APP_VERSION } from '@shared/app'
import { useChatStore } from '../stores/chat'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'

const api = window.yocim
const workspace = useWorkspaceStore()
const chat = useChatStore()
const settings = useSettingsStore()

const runState = computed(() => (chat.sending ? '生成中' : '空闲'))
</script>

<template>
  <footer class="statusbar" :class="{ expanded: settings.statusExpanded }" data-testid="status-bar">
    <span>v{{ APP_VERSION }}</span>
    <span class="workspace-name">{{ workspace.info ? workspace.info.name : '无工作区' }}</span>
    <span
      v-if="workspace.info?.remote"
      class="remote-badge"
      data-testid="status-remote-badge"
      :title="workspace.info.remote.displayRoot"
    >
      {{ workspace.info.remote.kind === 'wsl' ? 'WSL' : 'SSH' }} ·
      {{ workspace.info.remote.rootPath }}
    </span>
    <span class="run-state" :class="{ active: chat.sending }">{{ runState }}</span>

    <template v-if="settings.statusExpanded">
      <span v-if="workspace.activeFile" class="file">{{ workspace.activeFile.relativePath }}</span>
      <span>Electron {{ api?.versions.electron || 'n/a' }}</span>
      <span>Node {{ api?.versions.node || 'n/a' }}</span>
      <span>{{ api?.platform || 'unknown' }}</span>
    </template>

    <span class="spacer"></span>
    <button
      type="button"
      class="toggle"
      data-testid="status-toggle"
      :title="settings.statusExpanded ? '收起状态栏 (Ctrl+J)' : '展开状态栏 (Ctrl+J)'"
      @click="settings.setStatusExpanded(!settings.statusExpanded)"
    >
      {{ settings.statusExpanded ? '收起' : '展开' }}
    </button>
  </footer>
</template>

<style scoped>
.remote-badge {
  max-width: 240px;
  padding: 0 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.statusbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  min-height: 24px;
  padding: 3px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
  font-size: 11.5px;
  color: var(--text-muted);
}

.statusbar.expanded {
  padding: 8px 14px;
}

.workspace-name {
  max-width: 30vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-state {
  color: var(--text-muted);
}

.run-state.active {
  color: var(--accent);
}

.file {
  max-width: 40vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.toggle {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.toggle:hover {
  color: var(--accent);
}
</style>
