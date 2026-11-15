<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDebugStore } from '../stores/debug'
import CollapsibleSection from './CollapsibleSection.vue'

const debug = useDebugStore()
const conditionDrafts = ref<Record<string, string>>({})

const breakpointCount = computed(() => debug.breakpoints.length)

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

function conditionOf(id: string, current?: string): string {
  return conditionDrafts.value[id] ?? current ?? ''
}

function updateCondition(id: string, value: string): void {
  conditionDrafts.value[id] = value
}

async function applyCondition(id: string): Promise<void> {
  const value = conditionDrafts.value[id]
  if (value === undefined) return
  await debug.setBreakpointCondition(id, value)
  delete conditionDrafts.value[id]
}
</script>

<template>
  <CollapsibleSection
    title="断点"
    section="debugBreakpoints"
    testid="debug-breakpoints"
    :count="breakpointCount"
  >
    <div v-if="!breakpointCount" class="hint" data-testid="debug-breakpoints-empty">
      在编辑器左侧点击行号槽位添加断点；条件断点可在下方输入表达式
    </div>
    <ul v-else class="bp-list">
      <li
        v-for="bp in debug.breakpoints"
        :key="bp.id"
        class="bp-row"
        :data-testid="`debug-breakpoint-${bp.id}`"
      >
        <span class="bp-dot" :class="{ verified: bp.verified }" title="断点"></span>
        <span class="bp-path" :title="bp.relativePath">
          {{ baseName(bp.relativePath) }}:{{ bp.line }}
        </span>
        <input
          type="text"
          class="bp-condition"
          placeholder="条件"
          :value="conditionOf(bp.id, bp.condition)"
          :data-testid="`debug-breakpoint-condition-${bp.id}`"
          @input="updateCondition(bp.id, ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="applyCondition(bp.id)"
          @blur="applyCondition(bp.id)"
        />
        <button
          type="button"
          class="remove"
          title="删除断点"
          :data-testid="`debug-breakpoint-remove-${bp.id}`"
          @click="debug.removeBreakpoint(bp.id)"
        >
          ×
        </button>
      </li>
    </ul>
  </CollapsibleSection>
</template>

<style scoped>
.hint {
  padding: 8px 10px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.bp-list {
  margin: 0;
  padding: 2px 0 6px;
  list-style: none;
}

.bp-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 11.5px;
}

.bp-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border: 1px solid var(--danger);
  border-radius: 50%;
  background: transparent;
}

.bp-dot.verified {
  background: var(--danger);
}

.bp-path {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bp-condition {
  flex: 1;
  min-width: 0;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 10.5px;
}

.remove {
  flex: none;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.remove:hover {
  background: var(--bg-hover);
  color: var(--text);
}
</style>
