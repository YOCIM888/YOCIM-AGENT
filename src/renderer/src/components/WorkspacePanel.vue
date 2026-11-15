<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { FsTreeNode } from '@shared/ipc'
import { WORKSPACE_VIEWS, type WorkspaceView } from '../lib/workspaceViews'
import { useChatStore } from '../stores/chat'
import { useProjectsStore } from '../stores/projects'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'
import AuditPanel from './AuditPanel.vue'
import EditorPane from './EditorPane.vue'
import FileTreePanel from './FileTreePanel.vue'
import ViewPlaceholder from './ViewPlaceholder.vue'
import WorkspaceActivityBar from './WorkspaceActivityBar.vue'

const settings = useSettingsStore()
const workspace = useWorkspaceStore()
const projects = useProjectsStore()
const chat = useChatStore()

const mountedViews = reactive(new Set<WorkspaceView>([settings.workspaceView]))
if (workspace.activeFile) mountedViews.add('editor')

const placeholderViews = WORKSPACE_VIEWS.filter((view) => view.phase)

function selectView(view: WorkspaceView): void {
  mountedViews.add(view)
  settings.setWorkspaceView(view)
}

function openFile(node: FsTreeNode, pin: boolean): void {
  selectView('editor')
  void workspace.openFile(node, { pin })
}

function attachFile(node: FsTreeNode): void {
  void chat.attachFile(node)
}

async function switchWorkspace(): Promise<void> {
  await workspace.select()
  await projects.refresh()
}

watch(
  () => [workspace.pendingReveal, workspace.diff] as const,
  ([reveal, diff]) => {
    if (reveal || diff) selectView('editor')
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

    <div class="activity-row">
      <WorkspaceActivityBar :active="settings.workspaceView" @select="selectView" />
      <button
        v-if="settings.workspaceView === 'files'"
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
      <FileTreePanel
        v-if="mountedViews.has('files')"
        v-show="settings.workspaceView === 'files'"
        @open="openFile"
        @attach="attachFile"
      />
      <EditorPane v-if="mountedViews.has('editor')" v-show="settings.workspaceView === 'editor'" />
      <AuditPanel
        v-if="mountedViews.has('audit')"
        v-show="settings.workspaceView === 'audit'"
        :active="settings.workspaceView === 'audit'"
      />
      <ViewPlaceholder
        v-for="view in placeholderViews"
        v-show="settings.workspaceView === view.key"
        :key="view.key"
        :view="view"
      />
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

.activity-row {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
}

.tab-action {
  flex: none;
  margin-right: 8px;
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
