<script setup lang="ts">
import { computed, inject } from 'vue'
import type { FsTreeNode } from '@shared/ipc'
import { FILE_TREE_KEY } from '../lib/fileTree'
import { useWorkspaceStore } from '../stores/workspace'
import FileTypeIcon from './FileTypeIcon.vue'
import TreeNameInput from './TreeNameInput.vue'

defineOptions({ name: 'FileTreeNode' })

const props = defineProps<{
  node: FsTreeNode
  depth: number
}>()

const workspace = useWorkspaceStore()
const tree = inject(FILE_TREE_KEY)!

const isDir = computed(() => props.node.type === 'directory')
const expanded = computed(() => workspace.expanded.has(props.node.relativePath))
const loading = computed(() => workspace.loadingDirs.has(props.node.relativePath))
const children = computed(() => workspace.childrenOf(props.node.relativePath))
const selected = computed(() => workspace.selectedPath === props.node.relativePath)
const active = computed(() => workspace.activeFile?.relativePath === props.node.relativePath)
const cut = computed(
  () =>
    workspace.clipboard?.mode === 'cut' &&
    workspace.clipboard.relativePath === props.node.relativePath
)
const renaming = computed(
  () => tree.editing.value?.kind === 'rename' && tree.editing.value.path === props.node.relativePath
)
const createKind = computed(() => {
  const editing = tree.editing.value
  if (editing && (editing.kind === 'create-file' || editing.kind === 'create-folder')) {
    return editing.kind
  }
  return null
})
const creatingHere = computed(
  () =>
    isDir.value &&
    expanded.value &&
    createKind.value !== null &&
    (tree.editing.value as { parentPath: string }).parentPath === props.node.relativePath
)

function handleClick(): void {
  if (isDir.value) {
    void workspace.toggleDir(props.node)
    return
  }
  tree.open(props.node, false)
}

function handleDblClick(): void {
  if (!isDir.value) tree.open(props.node, true)
}

function handleContextMenu(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  workspace.selectedPath = props.node.relativePath
  tree.requestContextMenu(props.node, event)
}

function more(event: MouseEvent): void {
  workspace.selectedPath = props.node.relativePath
  tree.requestContextMenu(props.node, event)
}
</script>

<template>
  <li class="node">
    <div
      class="row"
      :class="{ selected, active, cut, directory: isDir }"
      :style="{ paddingLeft: `${depth * 14 + 8}px` }"
      :data-testid="`tree-node-${node.relativePath}`"
      :title="node.name"
      @click="handleClick"
      @dblclick="handleDblClick"
      @contextmenu="handleContextMenu"
    >
      <span v-if="isDir" class="chevron">{{ expanded ? '▾' : '▸' }}</span>
      <span v-else class="chevron spacer"></span>
      <FileTypeIcon :name="node.name" :type="node.type" :expanded="expanded" />
      <TreeNameInput
        v-if="renaming"
        :initial="node.name"
        select-basename
        testid="tree-rename-input"
        @commit="tree.commitEdit"
        @cancel="tree.cancelEdit"
      />
      <span v-else class="name" :class="{ preview: active && workspace.isPreview }">
        {{ node.name }}
      </span>
      <span class="actions" @click.stop @dblclick.stop>
        <button
          v-if="isDir"
          type="button"
          class="act"
          title="新建文件"
          :data-testid="`tree-new-file-${node.relativePath}`"
          @click="tree.startCreate(node.relativePath, 'create-file')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.2" d="M4 1.5h5L12.5 5v9.5H4Z" />
            <path stroke="currentColor" stroke-width="1.2" d="M8 7v4M6 9h4" />
          </svg>
        </button>
        <button
          v-if="isDir"
          type="button"
          class="act"
          title="新建文件夹"
          :data-testid="`tree-new-folder-${node.relativePath}`"
          @click="tree.startCreate(node.relativePath, 'create-folder')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              d="M1.5 3.5h4l1.2 1.5h7.8v8h-13Z"
            />
            <path stroke="currentColor" stroke-width="1.2" d="M8 7.5v3.5M6.2 9.2h3.6" />
          </svg>
        </button>
        <button
          type="button"
          class="act more"
          title="更多操作"
          :data-testid="`tree-more-${node.relativePath}`"
          @click="more"
        >
          ⋯
        </button>
      </span>
    </div>
    <ul v-if="isDir && expanded" class="children">
      <li v-if="creatingHere" class="node">
        <div class="row create-row" :style="{ paddingLeft: `${(depth + 1) * 14 + 8}px` }">
          <span class="chevron spacer"></span>
          <FileTypeIcon name="" :type="createKind === 'create-folder' ? 'directory' : 'file'" />
          <TreeNameInput
            testid="tree-create-input"
            @commit="tree.commitEdit"
            @cancel="tree.cancelEdit"
          />
        </div>
      </li>
      <FileTreeNode
        v-for="child in children"
        :key="child.relativePath"
        :node="child"
        :depth="depth + 1"
      />
      <li v-if="loading" class="hint" :style="{ paddingLeft: `${(depth + 1) * 14 + 8}px` }">
        加载中…
      </li>
      <li
        v-else-if="!children.length && !creatingHere"
        class="hint"
        :style="{ paddingLeft: `${(depth + 1) * 14 + 8}px` }"
      >
        空目录
      </li>
    </ul>
  </li>
</template>

<style scoped>
.node {
  list-style: none;
}

.children {
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 6px;
  color: var(--text);
  font-size: 12.5px;
  cursor: pointer;
  user-select: none;
}

.row:hover {
  background: var(--bg-hover);
}

.row.selected {
  background: var(--accent-soft);
}

.row.active {
  background: var(--accent-soft);
}

.row.cut {
  opacity: 0.5;
}

.chevron {
  width: 12px;
  flex: none;
  color: var(--text-muted);
  font-size: 10px;
  text-align: center;
}

.chevron.spacer {
  visibility: hidden;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name.preview {
  font-style: italic;
}

.actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: none;
  opacity: 0;
}

.row:hover .actions,
.row.selected .actions {
  opacity: 1;
}

.act {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.act:hover {
  background: var(--bg-elevated);
  color: var(--text);
}

.act.more {
  font-size: 14px;
  line-height: 1;
}

.hint {
  padding-top: 3px;
  padding-bottom: 3px;
  list-style: none;
  font-size: 11.5px;
  color: var(--text-muted);
}
</style>
