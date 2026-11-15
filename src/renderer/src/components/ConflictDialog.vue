<script setup lang="ts">
import type { FsConflictResolution } from '@shared/ipc'

defineProps<{
  name: string
}>()

const emit = defineEmits<{
  resolve: [resolution: FsConflictResolution]
  close: []
}>()
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" data-testid="conflict-dialog">
      <h2>目标已存在</h2>
      <p class="message">目标位置已存在「{{ name }}」。请选择处理方式：</p>
      <div class="options">
        <button
          type="button"
          class="option"
          data-testid="conflict-keep-both"
          @click="emit('resolve', 'keep-both')"
        >
          <span class="option-title">保留两者</span>
          <span class="option-desc">重命名新条目为「{{ name }} (2)」</span>
        </button>
        <button
          type="button"
          class="option"
          data-testid="conflict-replace"
          @click="emit('resolve', 'replace')"
        >
          <span class="option-title">替换</span>
          <span class="option-desc">覆盖目标，源文件移入回收站</span>
        </button>
        <button
          type="button"
          class="option"
          data-testid="conflict-skip"
          @click="emit('resolve', 'skip')"
        >
          <span class="option-title">跳过</span>
          <span class="option-desc">不粘贴该条目</span>
        </button>
      </div>
      <div class="actions">
        <button type="button" data-testid="conflict-cancel" @click="emit('close')">取消</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
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

.actions {
  display: flex;
  justify-content: flex-end;
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

.actions button:hover {
  background: var(--bg-hover);
}
</style>
