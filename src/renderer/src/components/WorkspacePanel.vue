<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { FsTreeNode } from '@shared/ipc'
import { WORKSPACE_VIEWS, type WorkspaceView } from '../lib/workspaceViews'
import { useChatStore } from '../stores/chat'
import { useScmStore } from '../stores/scm'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'
import AuditPanel from './AuditPanel.vue'
import EditorPane from './EditorPane.vue'
import ExtensionsPanel from './ExtensionsPanel.vue'
import FileTreePanel from './FileTreePanel.vue'
import RunPanel from './RunPanel.vue'
import ScmPanel from './ScmPanel.vue'
import SearchPanel from './SearchPanel.vue'
import ViewPlaceholder from './ViewPlaceholder.vue'
import WorkspaceActivityBar from './WorkspaceActivityBar.vue'

const settings = useSettingsStore()
const workspace = useWorkspaceStore()
const chat = useChatStore()
const scm = useScmStore()

// 编辑器与搜索视图常驻挂载（v-show），保留各自标签、滚动位置与输入状态
const mountedViews = reactive(new Set<WorkspaceView>([settings.workspaceView, 'editor']))

const placeholderViews = WORKSPACE_VIEWS.filter((view) => view.phase)

const activityBadges = computed(() => ({ scm: scm.changeCount }))

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

watch(
  () => [workspace.pendingReveal, workspace.diff] as const,
  ([reveal, diff]) => {
    if (diff || (reveal && !reveal.keepView)) selectView('editor')
  }
)

// 工作区变化后刷新 Git 变更数，活动栏 badge 不依赖是否打开过源代码管理
watch(
  () => workspace.info?.root,
  () => {
    if (workspace.info) void scm.refresh({ silent: true })
  },
  { immediate: true }
)
</script>

<template>
  <aside
    class="workspace-panel"
    data-testid="workspace-panel"
    :style="{ width: `${settings.workspaceWidth}px` }"
  >
    <div class="activity-row">
      <WorkspaceActivityBar
        :active="settings.workspaceView"
        :badges="activityBadges"
        @select="selectView"
      />
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
      <SearchPanel v-show="settings.workspaceView === 'search'" />
      <EditorPane v-show="settings.workspaceView === 'editor'" />
      <AuditPanel
        v-if="mountedViews.has('audit')"
        v-show="settings.workspaceView === 'audit'"
        :active="settings.workspaceView === 'audit'"
      />
      <ScmPanel
        v-if="mountedViews.has('scm')"
        v-show="settings.workspaceView === 'scm'"
        :active="settings.workspaceView === 'scm'"
      />
      <ExtensionsPanel
        v-if="mountedViews.has('extensions')"
        v-show="settings.workspaceView === 'extensions'"
        :active="settings.workspaceView === 'extensions'"
      />
      <RunPanel
        v-if="mountedViews.has('debug')"
        v-show="settings.workspaceView === 'debug'"
        :active="settings.workspaceView === 'debug'"
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
