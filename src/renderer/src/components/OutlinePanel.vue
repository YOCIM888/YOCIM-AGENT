<script setup lang="ts">
import { t } from '../i18n'
import { computed } from 'vue'
import { languageForPath } from '../lib/language'
import { extractOutline, type OutlineKind, type OutlineSymbol } from '../lib/outline'
import { useWorkspaceStore } from '../stores/workspace'
import CollapsibleSection from './CollapsibleSection.vue'

const workspace = useWorkspaceStore()

const symbols = computed<OutlineSymbol[]>(() => {
  const file = workspace.activeFile
  if (!file) return []
  return extractOutline(file.content, languageForPath(file.relativePath))
})

const activeIndex = computed(() => {
  const line = workspace.cursorLine
  let index = -1
  symbols.value.forEach((symbol, i) => {
    if (symbol.line <= line) index = i
  })
  return index
})

const GLYPHS: Record<OutlineKind, string> = {
  class: 'C',
  interface: 'I',
  type: 'T',
  enum: 'E',
  function: 'ƒ',
  method: 'm',
  variable: 'v',
  heading: '#',
  key: '{}',
  selector: '⌗'
}

function jump(symbol: OutlineSymbol): void {
  workspace.requestReveal(symbol.line)
}
</script>

<template>
  <CollapsibleSection
    :title="t('大纲')"
    section="outline"
    testid="outline-section"
    :count="symbols.length"
  >
    <p v-if="!workspace.activeFile" class="empty" data-testid="outline-empty">
      {{ t('打开文件后显示大纲') }}
    </p>
    <p v-else-if="!symbols.length" class="empty">{{ t('未识别到符号') }}</p>
    <ul v-else class="symbols">
      <li v-for="(symbol, index) in symbols" :key="`${symbol.line}-${symbol.name}`">
        <button
          type="button"
          class="symbol"
          :class="{ active: index === activeIndex }"
          :style="{ paddingLeft: `${symbol.depth * 12 + 8}px` }"
          :data-testid="`outline-item-${symbol.line}`"
          :title="`${symbol.name} · 第 ${symbol.line} 行`"
          @click="jump(symbol)"
        >
          <span class="glyph" :data-kind="symbol.kind">{{ GLYPHS[symbol.kind] }}</span>
          <span class="name">{{ symbol.name }}</span>
          <span class="line">{{ symbol.line }}</span>
        </button>
      </li>
    </ul>
  </CollapsibleSection>
</template>

<style scoped>
.empty {
  margin: 0;
  padding: 10px 12px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.symbols {
  margin: 0;
  padding: 4px 0;
  list-style: none;
}

.symbol {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 8px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.symbol:hover {
  background: var(--bg-hover);
}

.symbol.active {
  background: var(--accent-soft);
}

.glyph {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 4px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 9.5px;
  font-weight: 700;
}

.glyph[data-kind='class'],
.glyph[data-kind='interface'],
.glyph[data-kind='type'],
.glyph[data-kind='enum'] {
  color: #dcb67a;
}

.glyph[data-kind='function'],
.glyph[data-kind='method'] {
  color: #6d9eeb;
}

.glyph[data-kind='heading'] {
  color: #519aba;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.line {
  flex: none;
  font-size: 10px;
  color: var(--text-muted);
}
</style>
