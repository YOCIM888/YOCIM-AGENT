<script setup lang="ts">
import { onBeforeUnmount } from 'vue'

const props = withDefaults(
  defineProps<{
    side: 'left' | 'right'
    value: number
    min?: number
    max?: number
  }>(),
  { min: 220, max: 420 }
)

const emit = defineEmits<{
  update: [value: number]
  reset: []
}>()

let dragging = false
let startX = 0
let startValue = 0

function clamp(value: number): number {
  return Math.min(props.max, Math.max(props.min, Math.round(value)))
}

function stop(): void {
  dragging = false
  document.body.classList.remove('col-resizing')
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', stop)
  window.removeEventListener('pointercancel', stop)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return
  const delta = event.clientX - startX
  const next = props.side === 'left' ? startValue + delta : startValue - delta
  emit('update', clamp(next))
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  dragging = true
  startX = event.clientX
  startValue = props.value
  document.body.classList.add('col-resizing')
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const direction = event.key === 'ArrowRight' ? 1 : -1
  const delta = props.side === 'left' ? direction : -direction
  const step = event.shiftKey ? 40 : 10
  emit('update', clamp(props.value + delta * step))
}

onBeforeUnmount(stop)
</script>

<template>
  <div
    class="resize-handle"
    :class="side"
    :data-testid="`resize-${side}`"
    role="separator"
    aria-orientation="vertical"
    :aria-label="side === 'left' ? '调整会话栏宽度' : '调整工作区宽度'"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="value"
    tabindex="0"
    title="拖动调整宽度，双击恢复默认"
    @pointerdown="onPointerDown"
    @keydown="onKeydown"
    @dblclick="emit('reset')"
  ></div>
</template>

<style scoped>
.resize-handle {
  position: relative;
  z-index: 5;
  flex: none;
  width: 6px;
  margin: 0 -3px;
  cursor: col-resize;
  touch-action: none;
}

.resize-handle::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  background: var(--border);
  content: '';
  transition: background-color 120ms ease;
}

.resize-handle:hover::after,
.resize-handle:focus-visible::after {
  background: var(--accent);
}

.resize-handle:focus-visible {
  outline: none;
}
</style>
