<script setup lang="ts">
import { t } from '../i18n'
import { WORKSPACE_VIEWS, type WorkspaceView } from '../lib/workspaceViews'
import WorkspaceViewIcon from './WorkspaceViewIcon.vue'

withDefaults(
  defineProps<{
    active: WorkspaceView
    /** 图标右上角徽标数字（例如源代码管理的变更数） */
    badges?: Partial<Record<WorkspaceView, number>>
  }>(),
  { badges: () => ({}) }
)

const emit = defineEmits<{ select: [view: WorkspaceView] }>()
</script>

<template>
  <div
    class="activity-bar"
    role="tablist"
    :aria-label="t('工作区视图')"
    data-testid="workspace-activity-bar"
  >
    <template v-for="view in WORKSPACE_VIEWS" :key="view.key">
      <span v-if="view.key === 'scm'" class="separator" aria-hidden="true"></span>
      <button
        type="button"
        role="tab"
        class="activity-button"
        :class="{ active: active === view.key }"
        :aria-selected="active === view.key"
        :data-testid="view.testid"
        :title="t(view.label)"
        :aria-label="t(view.label)"
        @click="emit('select', view.key)"
      >
        <WorkspaceViewIcon :name="view.key" />
        <span
          v-if="badges[view.key]"
          class="badge"
          :data-testid="`${view.testid}-badge`"
          :title="`${badges[view.key]} 个变更`"
        >
          {{ (badges[view.key] ?? 0) > 99 ? '99+' : badges[view.key] }}
        </span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.activity-bar {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: 41px;
  padding: 0 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.activity-bar::-webkit-scrollbar {
  display: none;
}

.activity-button {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.activity-button:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.activity-button.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.activity-button.active::after {
  content: '';
  position: absolute;
  right: 4px;
  bottom: -5px;
  left: 4px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
}

.separator {
  flex: none;
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border-strong);
}

.badge {
  position: absolute;
  top: -3px;
  right: -5px;
  min-width: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
  z-index: 1;
}
</style>
