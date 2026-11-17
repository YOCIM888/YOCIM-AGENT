<script setup lang="ts">
import { t } from '../i18n'
import { ref } from 'vue'
import BrowserView from './BrowserView.vue'
import TerminalPanel from './TerminalPanel.vue'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()
const settings = useSettingsStore()

const host = ref<HTMLDivElement | null>(null)
let dragging = false
let startY = 0
let startHeight = 0

function stop(): void {
  if (!dragging) return
  dragging = false
  document.body.classList.remove('row-resizing')
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', stop)
  window.removeEventListener('pointercancel', stop)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging || !host.value) return
  const parentHeight = host.value.getBoundingClientRect().height || window.innerHeight
  const delta = startY - event.clientY
  settings.setToolPanelHeight(Math.round(startHeight + (delta / parentHeight) * 100))
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  dragging = true
  startY = event.clientY
  startHeight = settings.toolPanelHeight
  document.body.classList.add('row-resizing')
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  const step = event.shiftKey ? 5 : 2
  settings.setToolPanelHeight(settings.toolPanelHeight + (event.key === 'ArrowUp' ? step : -step))
}
</script>

<template>
  <section
    ref="host"
    class="tool-deck"
    :style="{ height: `${settings.toolPanelHeight}%` }"
    data-testid="tool-deck"
  >
    <div
      class="deck-resize"
      data-testid="tool-deck-resize"
      role="separator"
      aria-orientation="horizontal"
      :aria-label="t('调整工具区高度')"
      :aria-valuenow="settings.toolPanelHeight"
      tabindex="0"
      :title="t('拖动调整高度，双击恢复默认')"
      @pointerdown="onPointerDown"
      @keydown="onKeydown"
      @dblclick="settings.setToolPanelHeight(settings.toolPanelHeightDefault)"
    ></div>

    <nav class="deck-tabs" :aria-label="t('下半屏工具')">
      <button
        type="button"
        class="deck-tab"
        :class="{ active: ui.toolTab === 'terminal' }"
        data-testid="deck-tab-terminal"
        :aria-pressed="ui.toolTab === 'terminal'"
        @click="ui.activateTerminal()"
      >
        {{ t('终端') }}
      </button>
      <button
        type="button"
        class="deck-tab"
        :class="{ active: ui.toolTab === 'browser' }"
        data-testid="deck-tab-browser"
        :aria-pressed="ui.toolTab === 'browser'"
        @click="ui.activateBrowser()"
      >
        {{ t('浏览器') }}
      </button>
    </nav>

    <div class="deck-body">
      <!-- v-show 保留两个面板实例：切回终端时 xterm 滚动缓冲与运行状态不丢失 -->
      <TerminalPanel v-show="ui.toolTab === 'terminal'" @close="ui.closeTerminal()" />
      <BrowserView v-show="ui.toolTab === 'browser'" @close="ui.closeBrowser()" />
    </div>
  </section>
</template>

<script lang="ts">
export default { name: 'ToolDeck' }
</script>

<style scoped>
.tool-deck {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  min-height: 180px;
  max-height: 70%;
  border-top: 1px solid var(--border-strong);
  background: var(--bg);
}

.deck-resize {
  position: absolute;
  z-index: 6;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: row-resize;
  touch-action: none;
}
.deck-resize::after {
  position: absolute;
  top: 2px;
  left: 0;
  right: 0;
  height: 2px;
  background: transparent;
  content: '';
  transition: background-color 120ms ease;
}
.deck-resize:hover::after,
.deck-resize:focus-visible::after {
  background: var(--accent);
}
.deck-resize:focus-visible {
  outline: none;
}

.deck-tabs {
  display: flex;
  flex: none;
  gap: 2px;
  height: 28px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}
.deck-tab {
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.deck-tab:hover {
  color: var(--text);
}
.deck-tab.active {
  border-bottom-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.deck-body {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.deck-body > :deep(.terminal-panel) {
  flex: 1;
  min-height: 0;
  height: auto;
  max-height: none;
  border-top: 0;
}
</style>
