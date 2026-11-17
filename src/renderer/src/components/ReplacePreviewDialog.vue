<script setup lang="ts">
import { t } from '../i18n'
import { computed } from 'vue'
import type { SearchReplaceResult } from '@shared/ipc'

const props = defineProps<{
  result: SearchReplaceResult
  scope: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const changedFiles = computed(() => props.result.files.filter((file) => file.replaced > 0))
const conflicts = computed(() => props.result.files.filter((file) => file.status === 'conflict'))

const scopeLabel = computed<Record<string, string>>(() => ({
  single: t('单条替换'),
  file: t('文件内全部替换'),
  all: t('全局全部替换')
}))
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <section class="dialog" data-testid="replace-preview-dialog">
      <h2>{{ t('替换预览') }}</h2>
      <p class="summary" data-testid="replace-preview-summary">
        {{ scopeLabel[scope] ?? scope }} {{ t('· 将替换') }}
        <strong>{{ result.totalReplaced }}</strong> {{ t('处，涉及') }}
        <strong>{{ changedFiles.length }}</strong>
        {{ t('个文件。应用前会校验文件内容 hash，并在时间线生成回滚快照。') }}
      </p>
      <p v-if="conflicts.length" class="conflict" data-testid="replace-preview-conflicts">
        {{ conflicts.length }} {{ t('个文件在搜索后被修改，将被跳过：')
        }}{{ conflicts.map((f) => f.relativePath).join('、') }}
      </p>
      <div class="previews" data-testid="replace-preview-list">
        <div v-for="file in changedFiles.slice(0, 8)" :key="file.relativePath" class="file">
          <div class="file-name">{{ file.relativePath }} · {{ file.replaced }} {{ t('处') }}</div>
          <div v-for="line in file.previews" :key="line.line" class="line">
            <span class="line-no">{{ line.line }}</span>
            <span class="diff-text">
              <span class="before">- {{ line.before }}</span>
              <span class="after">+ {{ line.after }}</span>
            </span>
          </div>
        </div>
        <p v-if="!changedFiles.length" class="empty">{{ t('没有可替换的命中') }}</p>
      </div>
      <div class="actions">
        <button type="button" data-testid="replace-preview-cancel" @click="emit('cancel')">
          {{ t('取消') }}
        </button>
        <button
          type="button"
          class="primary"
          data-testid="replace-preview-confirm"
          :disabled="!changedFiles.length"
          @click="emit('confirm')"
        >
          {{ t('应用替换') }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: rgba(16, 24, 40, 0.28);
}

.dialog {
  width: min(560px, 80vw);
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  padding: 20px 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}

h2 {
  margin: 0 0 8px;
  font-size: 16px;
}

.summary {
  margin: 0 0 10px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-muted);
}

.summary strong {
  color: var(--text);
}

.conflict {
  margin: 0 0 10px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11.5px;
}

.previews {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.file {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.file-name {
  font-size: 12px;
  font-weight: 600;
  word-break: break-all;
}

.line {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
}

.line-no {
  flex: none;
  width: 32px;
  color: var(--text-muted);
  text-align: right;
}

.diff-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  word-break: break-all;
}

.before {
  color: var(--danger);
}

.after {
  color: var(--success);
}

.empty {
  margin: 0;
  padding: 16px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
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

.actions button:disabled {
  opacity: 0.45;
  cursor: default;
}

.actions .primary {
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>
