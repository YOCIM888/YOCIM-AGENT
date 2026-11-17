<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, provide, ref } from 'vue'
import type { FsConflictResolution, FsTreeNode } from '@shared/ipc'
import { FILE_TREE_KEY, type TreeEditing } from '../lib/fileTree'
import type { ContextMenuItem } from '../lib/menu'
import { parentOf, useWorkspaceStore } from '../stores/workspace'
import ConflictDialog from './ConflictDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ContextMenu from './ContextMenu.vue'
import FileTreeNode from './FileTreeNode.vue'
import FileTypeIcon from './FileTypeIcon.vue'
import OutlinePanel from './OutlinePanel.vue'
import TimelinePanel from './TimelinePanel.vue'
import TreeNameInput from './TreeNameInput.vue'

const emit = defineEmits<{
  open: [node: FsTreeNode, pin: boolean]
  attach: [node: FsTreeNode]
}>()

const workspace = useWorkspaceStore()

const editing = ref<TreeEditing | null>(null)
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuTarget = ref<FsTreeNode | null>(null)
const conflict = ref<{ targetDir: string; name: string } | null>(null)
const pendingDelete = ref<FsTreeNode | null>(null)

const rootCreating = computed(() => {
  const value = editing.value
  return value !== null && value.kind !== 'rename' && value.parentPath === ''
})

function open(node: FsTreeNode, pin: boolean): void {
  emit('open', node, pin)
}

function startCreate(parentPath: string, kind: 'create-file' | 'create-folder'): void {
  if (parentPath && !workspace.expanded.has(parentPath)) {
    workspace.expanded.add(parentPath)
    void workspace.loadChildren(parentPath)
  }
  editing.value = { kind, parentPath }
}

function startRename(node: FsTreeNode): void {
  editing.value = { kind: 'rename', path: node.relativePath, name: node.name }
}

function cancelEdit(): void {
  editing.value = null
}

async function commitEdit(value: string): Promise<void> {
  const current = editing.value
  editing.value = null
  if (!current || !value) return
  if (current.kind === 'rename') {
    if (value === current.name) return
    await workspace.renameEntry(current.path, value)
    return
  }
  await workspace.createEntry(
    current.parentPath,
    value,
    current.kind === 'create-file' ? 'file' : 'directory'
  )
}

function pasteTargetDir(node: FsTreeNode | null): string {
  if (!node) return ''
  return node.type === 'directory' ? node.relativePath : parentOf(node.relativePath)
}

async function doPaste(
  targetDir: string,
  resolution: FsConflictResolution = 'error'
): Promise<void> {
  const result = await workspace.paste(targetDir, resolution)
  if (result && !result.ok && result.error.code === 'E_EXISTS') {
    conflict.value = { targetDir, name: workspace.clipboard?.name ?? '' }
  }
}

function buildMenu(node: FsTreeNode | null): ContextMenuItem[] {
  const hasClipboard = workspace.clipboard !== null
  if (!node) {
    return [
      { id: 'new-file', label: t('新建文件'), testid: 'menu-new-file' },
      { id: 'new-folder', label: t('新建文件夹'), testid: 'menu-new-folder' },
      {
        id: 'paste',
        label: t('粘贴'),
        testid: 'menu-paste',
        disabled: !hasClipboard,
        separatorBefore: true
      },
      { id: 'refresh', label: t('刷新'), testid: 'menu-refresh', separatorBefore: true },
      { id: 'collapse-all', label: t('全部折叠'), testid: 'menu-collapse-all' }
    ]
  }
  const isFile = node.type === 'file'
  return [
    { id: 'cut', label: t('剪切'), testid: 'menu-cut' },
    { id: 'copy', label: t('复制'), testid: 'menu-copy' },
    { id: 'paste', label: t('粘贴'), testid: 'menu-paste', disabled: !hasClipboard },
    { id: 'rename', label: t('重命名'), testid: 'menu-rename', separatorBefore: true },
    { id: 'attach', label: t('添加到对话'), testid: 'menu-attach', disabled: !isFile },
    {
      id: 'reveal',
      label: t('在文件资源管理器中显示'),
      testid: 'menu-reveal',
      separatorBefore: true
    },
    { id: 'copy-path', label: t('复制路径'), testid: 'menu-copy-path' },
    { id: 'copy-relative-path', label: t('复制相对路径'), testid: 'menu-copy-relative-path' },
    { id: 'delete', label: t('删除'), testid: 'menu-delete', danger: true, separatorBefore: true }
  ]
}

const menuItems = computed(() => buildMenu(menuTarget.value))

function requestContextMenu(node: FsTreeNode | null, event: MouseEvent): void {
  menuTarget.value = node
  menuX.value = event.clientX
  menuY.value = event.clientY
  menuOpen.value = true
}

function blankContextMenu(event: MouseEvent): void {
  requestContextMenu(null, event)
}

async function handleMenuSelect(id: string): Promise<void> {
  menuOpen.value = false
  const node = menuTarget.value
  const targetDir = pasteTargetDir(node)
  switch (id) {
    case 'cut':
      if (node) await workspace.setClipboard('cut', node.relativePath)
      break
    case 'copy':
      if (node) await workspace.setClipboard('copy', node.relativePath)
      break
    case 'paste':
      await doPaste(targetDir)
      break
    case 'rename':
      if (node) startRename(node)
      break
    case 'attach':
      if (node) emit('attach', node)
      break
    case 'reveal':
      if (node) await workspace.reveal(node.relativePath)
      break
    case 'copy-path':
      if (node && workspace.info)
        await workspace.copyText(`${workspace.info.root}/${node.relativePath}`)
      break
    case 'copy-relative-path':
      if (node) await workspace.copyText(node.relativePath)
      break
    case 'delete':
      if (node) pendingDelete.value = node
      break
    case 'new-file':
      startCreate(targetDir, 'create-file')
      break
    case 'new-folder':
      startCreate(targetDir, 'create-folder')
      break
    case 'refresh':
      await workspace.refreshTree()
      break
    case 'collapse-all':
      workspace.collapseAll()
      break
  }
}

async function confirmDelete(): Promise<void> {
  const node = pendingDelete.value
  pendingDelete.value = null
  if (node) await workspace.deleteEntry(node.relativePath)
}

async function resolveConflict(resolution: FsConflictResolution): Promise<void> {
  const state = conflict.value
  conflict.value = null
  if (state) await doPaste(state.targetDir, resolution)
}

provide(FILE_TREE_KEY, {
  editing,
  open,
  requestContextMenu,
  startCreate,
  commitEdit,
  cancelEdit
})

onMounted(() => {
  void workspace.refreshClipboard()
})
</script>

<template>
  <aside class="file-tree" data-testid="file-tree">
    <div class="toolbar">
      <button
        type="button"
        class="tool"
        :title="t('新建文件')"
        data-testid="tree-toolbar-new-file"
        :disabled="!workspace.info"
        @click="startCreate('', 'create-file')"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="1.2" d="M4 1.5h5L12.5 5v9.5H4Z" />
          <path stroke="currentColor" stroke-width="1.2" d="M8 7v4M6 9h4" />
        </svg>
      </button>
      <button
        type="button"
        class="tool"
        :title="t('新建文件夹')"
        data-testid="tree-toolbar-new-folder"
        :disabled="!workspace.info"
        @click="startCreate('', 'create-folder')"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
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
        class="tool"
        :title="t('刷新')"
        data-testid="tree-toolbar-refresh"
        :disabled="!workspace.info"
        @click="workspace.refreshTree()"
      >
        ↻
      </button>
      <button
        type="button"
        class="tool"
        :title="t('全部折叠')"
        data-testid="tree-toolbar-collapse"
        :disabled="!workspace.info"
        @click="workspace.collapseAll()"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="1.2" d="M2 4h12M2 8h12M2 12h12" />
        </svg>
      </button>
    </div>

    <p v-if="workspace.error" class="error" data-testid="tree-error">
      {{ t(workspace.error) }}
      <button type="button" class="dismiss" @click="workspace.clearError()">×</button>
    </p>

    <div class="tree-scroll" @contextmenu.prevent="blankContextMenu">
      <ul v-if="workspace.tree.length || rootCreating" class="tree">
        <li v-if="rootCreating" class="node">
          <div class="row create-row" :style="{ paddingLeft: '8px' }">
            <span class="chevron spacer"></span>
            <FileTypeIcon name="" type="file" />
            <TreeNameInput testid="tree-create-input" @commit="commitEdit" @cancel="cancelEdit" />
          </div>
        </li>
        <FileTreeNode
          v-for="node in workspace.tree"
          :key="node.relativePath"
          :node="node"
          :depth="0"
        />
      </ul>
      <p v-else class="empty" data-testid="workspace-empty">
        {{ workspace.info ? t('工作区为空') : t('选择工作区后可浏览文件') }}
      </p>
    </div>

    <OutlinePanel />
    <TimelinePanel />

    <ContextMenu
      v-if="menuOpen"
      :x="menuX"
      :y="menuY"
      :items="menuItems"
      @select="handleMenuSelect"
      @close="menuOpen = false"
    />
    <ConflictDialog
      v-if="conflict"
      :name="conflict.name"
      @resolve="resolveConflict"
      @close="conflict = null"
    />
    <ConfirmDialog
      v-if="pendingDelete"
      :title="t('删除确认')"
      :message="`确定将「${pendingDelete.name}」移入回收站吗？可从系统回收站恢复。`"
      :confirm-label="t('移入回收站')"
      danger
      testid="delete-dialog"
      @confirm="confirmDelete"
      @close="pendingDelete = null"
    />
  </aside>
</template>

<style scoped>
.file-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

.tool {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
}

.tool:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.tool:disabled {
  opacity: 0.4;
  cursor: default;
}

.error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 6px 10px;
  background: var(--danger-soft, rgba(240, 80, 51, 0.12));
  color: var(--danger);
  font-size: 11.5px;
}

.dismiss {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}

.tree-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.tree {
  margin: 0;
  padding: 6px 0 12px;
}

.node {
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 6px;
}

.chevron {
  width: 12px;
  flex: none;
}

.chevron.spacer {
  visibility: hidden;
}

.empty {
  padding: 14px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
