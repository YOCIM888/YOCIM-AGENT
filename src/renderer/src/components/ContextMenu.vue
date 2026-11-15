<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { ContextMenuItem } from '../lib/menu'

const props = defineProps<{
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{
  select: [id: string]
  close: []
}>()

const MENU_WIDTH = 208
const ITEM_HEIGHT = 30
const SEPARATOR_HEIGHT = 7
const EDGE = 8

const position = computed(() => {
  const rawHeight =
    props.items.length * ITEM_HEIGHT +
    props.items.filter((item) => item.separatorBefore).length * SEPARATOR_HEIGHT +
    10
  const height = Math.min(rawHeight, window.innerHeight * 0.6)
  return {
    left: `${Math.max(EDGE, Math.min(props.x, window.innerWidth - MENU_WIDTH - EDGE))}px`,
    top: `${Math.max(EDGE, Math.min(props.y, window.innerHeight - height - EDGE))}px`,
    width: `${MENU_WIDTH}px`
  }
})

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

function select(item: ContextMenuItem): void {
  if (item.disabled) return
  emit('select', item.id)
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="context-mask" @mousedown="emit('close')" @contextmenu.prevent="emit('close')"></div>
    <div class="context-menu" :style="position" role="menu" @mousedown.stop>
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separatorBefore" class="separator"></div>
        <button
          type="button"
          class="context-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          :data-testid="item.testid"
          role="menuitem"
          @click="select(item)"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.context-menu {
  position: fixed;
  z-index: 1001;
  max-height: 60vh;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  overflow-y: auto;
}

.context-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}

.context-item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.context-item.danger {
  color: var(--danger);
}

.context-item:disabled {
  opacity: 0.45;
  cursor: default;
}

.separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
</style>
