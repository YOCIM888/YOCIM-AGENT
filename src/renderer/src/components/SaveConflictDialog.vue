<script setup lang="ts">
import { t } from '../i18n'
import { computed, ref } from 'vue'
import { parentOf } from '../stores/workspace'

const props = defineProps<{
  relativePath: string
}>()

const emit = defineEmits<{
  overwrite: []
  reload: []
  saveAs: [path: string]
  close: []
}>()

const draft = ref('')
const showSaveAs = ref(false)

const suggested = computed(() => {
  const parent = parentOf(props.relativePath)
  const name = props.relativePath.split('/').pop() ?? props.relativePath
  const dot = name.lastIndexOf('.')
  const renamed = dot > 0 ? `${name.slice(0, dot)}.copy${name.slice(dot)}` : `${name}.copy`
  return parent ? `${parent}/${renamed}` : renamed
})

function openSaveAs(): void {
  draft.value = suggested.value
  showSaveAs.value = true
}

function confirmSaveAs(): void {
  const path = draft.value.trim()
  if (!path || path.includes('\\') || path.startsWith('/') || path.includes('..')) return
  emit('saveAs', path)
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" data-testid="save-conflict-dialog">
      <h2>{{ t('文件已被外部修改') }}</h2>
      <p class="message">
        「{{ relativePath
        }}{{ t('」在打开后被其他程序修改。请选择处理方式，外部版本已写入时间线快照。') }}
      </p>
      <div v-if="!showSaveAs" class="options">
        <button
          type="button"
          class="option"
          data-testid="save-conflict-overwrite"
          @click="emit('overwrite')"
        >
          <span class="option-title">{{ t('覆盖') }}</span>
          <span class="option-desc">{{ t('用当前编辑器内容覆盖磁盘版本') }}</span>
        </button>
        <button
          type="button"
          class="option"
          data-testid="save-conflict-reload"
          @click="emit('reload')"
        >
          <span class="option-title">{{ t('重新加载') }}</span>
          <span class="option-desc">{{ t('丢弃本地修改，读取磁盘上的最新内容') }}</span>
        </button>
        <button type="button" class="option" data-testid="save-conflict-saveas" @click="openSaveAs">
          <span class="option-title">{{ t('另存') }}</span>
          <span class="option-desc">{{ t('把当前内容保存为一个新文件') }}</span>
        </button>
      </div>
      <div v-else class="save-as">
        <label for="save-as-path">{{ t('新文件（工作区相对路径）') }}</label>
        <input
          id="save-as-path"
          v-model="draft"
          type="text"
          data-testid="save-as-input"
          @keydown.enter="confirmSaveAs"
        />
      </div>
      <div class="actions">
        <button type="button" data-testid="save-conflict-cancel" @click="emit('close')">
          {{ t('取消') }}
        </button>
        <button
          v-if="showSaveAs"
          type="button"
          class="primary"
          data-testid="save-as-confirm"
          @click="confirmSaveAs"
        >
          {{ t('保存为新文件') }}
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
  width: 400px;
  padding: 22px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}

.dialog h2 {
  margin: 0 0 8px;
  font-size: 16px;
}

.message {
  margin: 0 0 14px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-muted);
  word-break: break-all;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.option:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.option-title {
  font-size: 13px;
  font-weight: 600;
}

.option-desc {
  font-size: 11px;
  color: var(--text-muted);
}

.save-as {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.save-as input {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
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
</style>
