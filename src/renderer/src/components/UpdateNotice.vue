<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { useUpdateStore } from '../stores/update'

const store = useUpdateStore()
let toastTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => store.toast,
  (value) => {
    if (toastTimer) clearTimeout(toastTimer)
    if (value) toastTimer = setTimeout(() => store.clearToast(), 4000)
  }
)

onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <div v-if="store.info" class="overlay">
    <section class="notice" data-testid="update-notice">
      <h2>发现新版本</h2>
      <p class="version" data-testid="update-version">
        v{{ store.info.version }}
        <span v-if="store.info.assetName" class="asset">{{ store.info.assetName }}</span>
      </p>
      <p v-if="store.info.notes" class="notes" data-testid="update-notes">{{ store.info.notes }}</p>
      <p class="hint">点击「更新」会在浏览器中打开当前系统的安装包下载页。</p>
      <div class="actions">
        <button type="button" data-testid="update-cancel" @click="store.dismiss()">取消</button>
        <button
          type="button"
          class="primary"
          data-testid="update-confirm"
          @click="store.openDownload()"
        >
          更新
        </button>
      </div>
    </section>
  </div>
  <div v-else-if="store.toast" class="toast" data-testid="update-toast">{{ store.toast }}</div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  background: rgba(16, 24, 40, 0.32);
}

.notice {
  width: 440px;
  max-width: calc(100vw - 48px);
  padding: 22px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}

h2 {
  margin: 0 0 10px;
  font-size: 16px;
}

.version {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}

.asset {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.notes {
  max-height: 180px;
  margin: 0 0 10px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
}

.hint {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-muted);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

.actions button {
  padding: 7px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.actions button:hover {
  background: var(--bg-hover);
}

.actions .primary {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.toast {
  position: fixed;
  right: 24px;
  bottom: 40px;
  z-index: 80;
  max-width: 360px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
}
</style>
