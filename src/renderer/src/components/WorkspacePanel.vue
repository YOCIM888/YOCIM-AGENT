<script setup lang="ts">
import { ref, watch } from 'vue'
import { useProjectsStore } from '../stores/projects'
import { useSettingsStore, type WorkspaceTab } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'
import AuditPanel from './AuditPanel.vue'
import EditorPane from './EditorPane.vue'
import FileTreePanel from './FileTreePanel.vue'

const settings = useSettingsStore()
const workspace = useWorkspaceStore()
const projects = useProjectsStore()
const editorMounted = ref(settings.workspaceTab === 'editor' || Boolean(workspace.activeFile))

const tabs: Array<{ key: WorkspaceTab; label: string }> = [
  { key: 'files', label: '文件' },
  { key: 'editor', label: '编辑器' },
  { key: 'audit', label: '审计' }
]

function selectTab(tab: WorkspaceTab): void {
  if (tab === 'editor') editorMounted.value = true
  settings.setWorkspaceTab(tab)
}

async function switchWorkspace(): Promise<void> {
  await workspace.select()
  await projects.refresh()
}

watch(
  () => workspace.activeFile,
  (file) => {
    if (file) {
      editorMounted.value = true
      settings.setWorkspaceTab('editor')
    }
  }
)
</script>

<template>
  <aside
    class="workspace-panel"
    data-testid="workspace-panel"
    :style="{ width: `${settings.workspaceWidth}px` }"
  >
    <div class="panel-head">
      <div class="ws-info">
        <span class="ws-name">{{ workspace.info ? workspace.info.name : '工作区' }}</span>
        <span class="ws-path" :title="workspace.info?.root" data-testid="workspace-root">
          {{ workspace.info ? workspace.info.root : '未选择工作区' }}
        </span>
      </div>
      <button
        type="button"
        class="icon-button"
        data-testid="workspace-switch"
        title="切换工作区"
        @click="switchWorkspace"
      >
        ⇄
      </button>
      <button
        type="button"
        class="icon-button"
        data-testid="workspace-collapse"
        title="折叠工作区 (Ctrl+Shift+B)"
        @click="settings.setWorkspaceCollapsed(true)"
      >
        ›
      </button>
    </div>

    <div class="tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        class="tab"
        :class="{ active: settings.workspaceTab === tab.key }"
        :aria-selected="settings.workspaceTab === tab.key"
        :data-testid="tab.key === 'audit' ? 'audit-toggle' : `workspace-tab-${tab.key}`"
        @click="selectTab(tab.key)"
      >
        {{ tab.label }}
      </button>
      <button
        v-if="settings.workspaceTab === 'files'"
        type="button"
        class="tab-action"
        title="刷新文件树"
        :disabled="!workspace.info"
        @click="workspace.refreshTree()"
      >
        ↻
      </button>
    </div>

    <div class="panel-body">
      <FileTreePanel v-if="settings.workspaceTab === 'files'" />
      <EditorPane v-if="editorMounted" v-show="settings.workspaceTab === 'editor'" />
      <AuditPanel v-if="settings.workspaceTab === 'audit'" />
    </div>
  </aside>
</template>

<style scoped>
.workspace-panel {
  display: flex;
  flex: none;
  flex-direction: column;
  max-width: 45vw;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-subtle);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
}

.ws-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.ws-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-path {
  margin-top: 1px;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-button {
  flex: none;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.icon-button:hover {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
}

.tab {
  padding: 7px 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.tab:hover {
  color: var(--text);
}

.tab.active {
  border-bottom-color: var(--accent);
  color: var(--text);
}

.tab-action {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}

.tab-action:disabled {
  opacity: 0.4;
  cursor: default;
}

.panel-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.panel-body > * {
  flex: 1;
  min-width: 0;
}

@media (max-width: 1200px) {
  .workspace-panel {
    width: 240px;
  }
}

@media (max-width: 1024px) {
  .workspace-panel {
    width: 220px;
  }
}
</style>
