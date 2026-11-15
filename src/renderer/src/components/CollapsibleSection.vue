<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore, type WorkspaceSection } from '../stores/settings'

const props = defineProps<{
  title: string
  section: WorkspaceSection
  testid?: string
  count?: number
}>()

const settings = useSettingsStore()
const collapsed = computed(() => settings.workspaceSections[props.section])

function toggle(): void {
  settings.setSectionCollapsed(props.section, !collapsed.value)
}
</script>

<template>
  <section class="collapsible" :data-testid="testid">
    <button
      type="button"
      class="section-header"
      :data-testid="testid ? `${testid}-header` : undefined"
      :aria-expanded="!collapsed"
      @click="toggle"
    >
      <span class="chevron">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="title">{{ title }}</span>
      <span v-if="count !== undefined" class="count">{{ count }}</span>
    </button>
    <div v-show="!collapsed" class="section-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.collapsible {
  flex: none;
  border-top: 1px solid var(--border);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  background: var(--bg-subtle);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
}

.section-header:hover {
  background: var(--bg-hover);
}

.chevron {
  width: 10px;
  flex: none;
  color: var(--text-muted);
  font-size: 9px;
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 500;
}

.section-body {
  max-height: 240px;
  overflow: auto;
}
</style>
