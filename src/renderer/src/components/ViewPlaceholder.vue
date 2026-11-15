<script setup lang="ts">
import type { WorkspaceViewDef } from '../lib/workspaceViews'
import WorkspaceViewIcon from './WorkspaceViewIcon.vue'

defineProps<{ view: WorkspaceViewDef }>()
</script>

<template>
  <section class="placeholder" :data-testid="`${view.key}-panel`">
    <div class="icon">
      <WorkspaceViewIcon :name="view.key" />
    </div>
    <h2>{{ view.label }}</h2>
    <span class="phase">{{ view.phase }} 阶段交付 · 尚未实现</span>
    <ul v-if="view.summary?.length" class="summary">
      <li v-for="item in view.summary" :key="item">{{ item }}</li>
    </ul>
  </section>
</template>

<style scoped>
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 18px;
  overflow-y: auto;
  text-align: center;
}

.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  color: var(--accent);
}

.icon svg {
  width: 22px;
  height: 22px;
}

h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.phase {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-hover);
  font-size: 11px;
  color: var(--text-muted);
}

.summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  text-align: left;
}

.summary li {
  position: relative;
  padding-left: 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.summary li::before {
  content: '';
  position: absolute;
  top: 8px;
  left: 0;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--border-strong);
}
</style>
