<script setup lang="ts">
import { ref } from 'vue'
import type { FsTreeNode } from '@shared/ipc'

defineOptions({ name: 'FileTreeNode' })

const props = defineProps<{
  node: FsTreeNode
  depth: number
}>()

const emit = defineEmits<{
  open: [node: FsTreeNode]
}>()

const expanded = ref(true)

function handleClick(): void {
  if (props.node.type === 'directory') {
    expanded.value = !expanded.value
    return
  }
  emit('open', props.node)
}
</script>

<template>
  <li class="node">
    <button
      type="button"
      class="row"
      :class="node.type"
      :style="{ paddingLeft: `${depth * 14 + 10}px` }"
      :data-testid="`tree-node-${node.relativePath}`"
      :title="node.type === 'directory' ? (expanded ? '折叠目录' : '展开目录') : node.name"
      @click="handleClick"
    >
      <span class="icon">
        {{ node.type === 'directory' ? (expanded ? '▾' : '▸') : '·' }}
      </span>
      <span class="name">{{ node.name }}</span>
    </button>
    <ul v-if="node.children?.length && expanded" class="children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.relativePath"
        :node="child"
        :depth="depth + 1"
        @open="emit('open', $event)"
      />
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
  gap: 6px;
  width: 100%;
  padding-top: 4px;
  padding-bottom: 4px;
  padding-right: 10px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.row:hover {
  background: var(--bg-hover);
}

.icon {
  width: 12px;
  color: var(--text-muted);
  flex: none;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
