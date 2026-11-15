<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel?: string
    danger?: boolean
    testid?: string
  }>(),
  { confirmLabel: '确定', danger: false, testid: 'confirm-dialog' }
)

const emit = defineEmits<{
  confirm: []
  close: []
}>()
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" :data-testid="testid">
      <h2>{{ title }}</h2>
      <p class="message">{{ message }}</p>
      <div class="actions">
        <button type="button" data-testid="confirm-cancel" @click="emit('close')">取消</button>
        <button
          type="button"
          class="primary"
          :class="{ danger }"
          data-testid="confirm-ok"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
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
  width: 380px;
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
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-muted);
  word-break: break-all;
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

.actions .primary.danger {
  border-color: var(--danger);
  background: transparent;
  color: var(--danger);
}
</style>
