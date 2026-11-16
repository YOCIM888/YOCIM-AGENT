<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { MENU_WIDTH, menuContentHeight, type ContextMenuItem } from '../lib/menu'

const props = defineProps<{
  x: number
  y: number
  items: ContextMenuItem[]
  /** 额外页脚（如模型菜单里的上下文窗口选择）占用的高度，用于定位计算 */
  footerHeight?: number
  /** 菜单宽度，默认 208 */
  width?: number
}>()

const emit = defineEmits<{
  select: [id: string]
  close: []
}>()

const EDGE = 8

const menuWidth = computed(() => props.width ?? MENU_WIDTH)

const position = computed(() => {
  const rawHeight = menuContentHeight(props.items, props.footerHeight ?? 0)
  const height = Math.min(rawHeight, window.innerHeight * 0.6)
  return {
    left: `${Math.max(EDGE, Math.min(props.x, window.innerWidth - menuWidth.value - EDGE))}px`,
    top: `${Math.max(EDGE, Math.min(props.y, window.innerHeight - height - EDGE))}px`,
    width: `${menuWidth.value}px`
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
        <div v-if="item.group" class="group-header">{{ item.group }}</div>
        <button
          type="button"
          class="context-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          :data-testid="item.testid"
          :title="item.title"
          role="menuitem"
          @click="select(item)"
        >
          <span class="item-label">{{ item.label }}</span>
          <span
            v-if="item.selected !== undefined"
            class="item-radio"
            :class="{ on: item.selected }"
            :data-testid="item.testid ? `${item.testid}-radio` : undefined"
            aria-hidden="true"
          ></span>
        </button>
      </template>
      <div v-if="$slots.footer" class="footer" @mousedown.stop>
        <slot name="footer"></slot>
      </div>
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
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* 单选指示器：固定在菜单项最右侧，未选中是空心圆环，选中是绿色实心圆 + 对勾 */
.item-radio {
  flex: none;
  width: 13px;
  height: 13px;
  border: 1.5px solid var(--radio-ring);
  border-radius: 50%;
  background: transparent;
  position: relative;
}

.item-radio.on {
  border-color: var(--success);
  background: var(--success);
}

.item-radio.on::after {
  content: '';
  position: absolute;
  left: 3.6px;
  top: 1.2px;
  width: 3px;
  height: 6px;
  border: solid var(--on-success);
  border-width: 0 1.6px 1.6px 0;
  transform: rotate(42deg);
}

.group-header {
  padding: 7px 10px 3px;
  color: var(--text-muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}

.footer {
  margin-top: 5px;
  padding: 8px 6px 4px;
  border-top: 1px solid var(--border);
}
</style>
