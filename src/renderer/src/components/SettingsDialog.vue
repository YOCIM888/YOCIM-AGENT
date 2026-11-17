<script setup lang="ts">
import { t } from '../i18n'
import { computed, ref, watch } from 'vue'
import type { SettingsTabId } from '../stores/ui'
import AppearancePanel from './settings/AppearancePanel.vue'
import BillingPanel from './settings/BillingPanel.vue'
import BrowserPanel from './settings/BrowserPanel.vue'
import ImagePanel from './settings/ImagePanel.vue'
import ModelsPanel from './settings/ModelsPanel.vue'
import SearchPanel from './settings/SearchPanel.vue'
import StoragePanel from './settings/StoragePanel.vue'

const emit = defineEmits<{
  close: []
}>()
const props = defineProps<{
  initialTab?: SettingsTabId
  guideApiKey?: boolean
}>()

type TabId = SettingsTabId

const active = ref<TabId>(props.initialTab ?? 'models')
watch(
  () => props.initialTab,
  (tab) => {
    if (tab) active.value = tab
  }
)

/** 标签图标（24×24 线性描边，stroke 由 CSS 统一控制） */
const ICONS: Record<TabId, string[]> = {
  billing: ['<rect x="3" y="5" width="18" height="14" rx="2.5"/>', '<path d="M3 10h18"/>'],
  models: [
    '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
    '<path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>'
  ],
  search: ['<circle cx="11" cy="11" r="6"/>', '<path d="M20 20l-3.7-3.7"/>'],
  image: [
    '<rect x="3" y="4" width="18" height="16" rx="2"/>',
    '<circle cx="8.5" cy="9" r="1.6"/>',
    '<path d="m4 17 5-5 3.2 3.2L15 12l5 5"/>'
  ],
  appearance: [
    '<path d="M12 3.5l1.85 4.5 4.5 1.85-4.5 1.85L12 16.2l-1.85-4.5L5.65 9.85l4.5-1.85z"/>',
    '<path d="M18 15.5l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z"/>'
  ],
  storage: [
    '<ellipse cx="12" cy="6" rx="7" ry="3"/>',
    '<path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>',
    '<path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'
  ],
  browser: [
    '<circle cx="12" cy="12" r="8"/>',
    '<path d="M4 12h16"/>',
    '<path d="M12 4c2.4 2.7 3.6 5.3 3.6 8s-1.2 5.3-3.6 8c-2.4-2.7-3.6-5.3-3.6-8S9.6 6.7 12 4z"/>'
  ]
}

const tabs = computed<Array<{ id: TabId; label: string }>>(() => [
  { id: 'billing', label: t('账单') },
  { id: 'models', label: t('模型') },
  { id: 'search', label: t('搜索') },
  { id: 'image', label: t('生图') },
  { id: 'appearance', label: t('外观') },
  { id: 'storage', label: t('存储') },
  { id: 'browser', label: t('浏览器') }
])
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" data-testid="settings-dialog">
      <header class="dialog-head">
        <h2>{{ t('设置') }}</h2>
        <button type="button" class="close" :aria-label="t('关闭设置')" @click="emit('close')">
          ✕
        </button>
      </header>

      <div class="dialog-body">
        <nav class="tabs" role="tablist">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="tab"
            :class="{ active: active === tab.id }"
            role="tab"
            :aria-selected="active === tab.id"
            :data-testid="`settings-tab-${tab.id}`"
            @click="active = tab.id"
          >
            <svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                v-for="(d, index) in ICONS[tab.id]"
                :key="index"
                :d="d"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span>{{ tab.label }}</span>
          </button>
        </nav>

        <div class="panel-area">
          <ModelsPanel
            v-if="active === 'models'"
            :guide-api-key="props.guideApiKey"
            @close="emit('close')"
          />
          <BillingPanel v-else-if="active === 'billing'" @close="emit('close')" />
          <SearchPanel v-else-if="active === 'search'" @close="emit('close')" />
          <ImagePanel v-else-if="active === 'image'" @close="emit('close')" />
          <AppearancePanel v-else-if="active === 'appearance'" @close="emit('close')" />
          <StoragePanel v-else-if="active === 'storage'" @close="emit('close')" />
          <BrowserPanel v-else-if="active === 'browser'" @close="emit('close')" />
        </div>
      </div>

      <footer class="dialog-foot">
        <button type="button" class="sp-btn" data-testid="settings-close" @click="emit('close')">
          {{ t('关闭') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgba(16, 24, 40, 0.28);
  -webkit-app-region: no-drag;
}

.dialog {
  display: flex;
  flex-direction: column;
  width: min(940px, calc(100vw - 48px));
  height: min(660px, calc(100vh - 80px));
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.dialog-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}

.dialog-head h2 {
  margin: 0;
  font-size: 16px;
}

.close {
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.dialog-body {
  display: flex;
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--border);
}

.tabs {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 2px;
  width: 132px;
  padding: 12px 10px;
  border-right: 1px solid var(--border);
  background: var(--bg-subtle);
  overflow: auto;
}

.tab {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 130ms ease,
    color 130ms ease,
    border-color 130ms ease;
}

.tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.tab.active {
  border-color: var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-weight: 500;
}

.tab-icon {
  width: 15px;
  height: 15px;
  flex: none;
  opacity: 0.9;
}

.tab.active .tab-icon {
  color: var(--accent);
}

.panel-area {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.dialog-foot {
  display: flex;
  flex: none;
  justify-content: flex-end;
  padding: 10px 20px 14px;
  border-top: 1px solid var(--border);
}
</style>
