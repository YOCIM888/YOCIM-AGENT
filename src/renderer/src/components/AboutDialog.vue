<script setup lang="ts">
import { APP_NAME, APP_VERSION } from '@shared/app'
import { useUpdateStore } from '../stores/update'

const emit = defineEmits<{
  close: []
}>()

const update = useUpdateStore()
const api = window.yocim

const PLATFORM_LABELS: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
}

const infoRows = [
  { label: '版本', value: `v${APP_VERSION}` },
  { label: '平台', value: PLATFORM_LABELS[api.platform] ?? api.platform },
  { label: 'Electron', value: api.versions.electron },
  { label: 'Node.js', value: api.versions.node },
  { label: 'Chromium', value: api.versions.chrome }
]

function checkForUpdates(): void {
  emit('close')
  void update.check()
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" data-testid="about-dialog">
      <header class="dialog-head">
        <h2>关于</h2>
        <button type="button" class="close" aria-label="关闭关于窗口" @click="emit('close')">✕</button>
      </header>

      <div class="dialog-body">
        <div class="brand">
          <img class="brand-mark" src="/image/yocim.png" alt="YOCIM" />
          <div class="brand-text">
            <strong>{{ APP_NAME }}</strong>
            <span class="version-badge" data-testid="about-version">v{{ APP_VERSION }}</span>
          </div>
        </div>

        <p class="desc">本地优先的桌面 AI 编程助手，支持多模型对话、工作区编辑与命令行工具调用。</p>

        <dl class="info">
          <div v-for="row in infoRows" :key="row.label" class="info-row">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
      </div>

      <footer class="dialog-foot">
        <button type="button" class="sp-btn" data-testid="about-close" @click="emit('close')">
          关闭
        </button>
        <button
          type="button"
          class="sp-btn primary"
          data-testid="menu-check-update"
          :disabled="update.checking"
          @click="checkForUpdates"
        >
          {{ update.checking ? '检查中…' : '检查更新' }}
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
  width: min(440px, calc(100vw - 48px));
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
  padding: 4px 20px 20px;
  border-top: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 0 14px;
}

.brand-mark {
  width: 44px;
  height: 44px;
  flex: none;
  padding: 3px;
  border-radius: var(--radius-md);
  background: #ffffff;
  object-fit: contain;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.brand-text strong {
  font-size: 15px;
}

.version-badge {
  align-self: flex-start;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 11px;
}

.desc {
  margin: 0 0 16px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
}

.info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  overflow: hidden;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  background: var(--bg-elevated);
  font-size: 12px;
}

.info-row + .info-row {
  border-top: 1px solid var(--border);
}

.info-row dt {
  color: var(--text-muted);
}

.info-row dd {
  margin: 0;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.dialog-foot {
  display: flex;
  flex: none;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border);
}
</style>
