<script setup lang="ts">
import { useWorkspaceStore } from '../stores/workspace'
import FileTreeNode from './FileTreeNode.vue'

const workspace = useWorkspaceStore()
</script>

<template>
  <aside class="file-tree" data-testid="file-tree">
    <ul v-if="workspace.tree.length" class="tree">
      <FileTreeNode
        v-for="node in workspace.tree"
        :key="node.relativePath"
        :node="node"
        :depth="0"
        @open="workspace.openFile($event)"
      />
    </ul>
    <p v-else class="empty" data-testid="workspace-empty">
      {{ workspace.info ? '工作区为空' : '选择工作区后可浏览文件' }}
    </p>
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

.tree {
  flex: 1;
  margin: 0;
  padding: 8px 0 12px;
  overflow: auto;
}

.empty {
  padding: 14px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
