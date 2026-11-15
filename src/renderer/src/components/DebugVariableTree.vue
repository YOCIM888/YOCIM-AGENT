<script setup lang="ts">
import type { DebugVariable } from '@shared/debug'
import { useDebugStore } from '../stores/debug'

defineProps<{ variables: DebugVariable[] }>()

const debug = useDebugStore()

function isExpanded(variable: DebugVariable): boolean {
  return Boolean(variable.variablesReference && debug.expandedVars[variable.variablesReference])
}

function childrenOf(variable: DebugVariable): DebugVariable[] {
  if (!variable.variablesReference) return []
  return debug.variableCache[variable.variablesReference] ?? []
}

function toggle(variable: DebugVariable): void {
  if (variable.variablesReference) void debug.toggleVariable(variable.variablesReference)
}
</script>

<template>
  <ul class="var-list">
    <li v-for="variable in variables" :key="variable.name" class="var-row">
      <div class="var-line">
        <button
          v-if="variable.variablesReference"
          type="button"
          class="twist"
          :data-testid="`debug-var-toggle-${variable.name}`"
          @click="toggle(variable)"
        >
          {{ isExpanded(variable) ? '▾' : '▸' }}
        </button>
        <span v-else class="twist placeholder"></span>
        <span class="var-name">{{ variable.name }}</span>
        <span class="var-value" :title="variable.value" :data-testid="`debug-var-${variable.name}`">
          {{ variable.value }}
        </span>
      </div>
      <DebugVariableTree
        v-if="isExpanded(variable)"
        :variables="childrenOf(variable)"
        class="children"
      />
    </li>
  </ul>
</template>

<style scoped>
.var-list {
  margin: 0;
  padding: 0 0 0 6px;
  list-style: none;
}

.var-row {
  padding: 1px 0;
}

.var-line {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  font-size: 11.5px;
}

.twist {
  flex: none;
  width: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 9px;
  cursor: pointer;
}

.twist.placeholder {
  cursor: default;
}

.var-name {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.var-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.children {
  padding-left: 10px;
  border-left: 1px solid var(--border);
  margin-left: 6px;
}
</style>
