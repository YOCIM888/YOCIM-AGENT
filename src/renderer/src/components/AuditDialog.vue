<script setup lang="ts">
import AuditPanel from './AuditPanel.vue'

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div class="overlay" data-testid="audit-dialog" @click.self="emit('close')">
      <section class="dialog" role="dialog" aria-label="审计日志" data-testid="audit-dialog-card">
        <header class="dialog-head">
          <h2>审计日志</h2>
          <button
            type="button"
            class="icon-button"
            data-testid="audit-dialog-close"
            title="关闭"
            aria-label="关闭审计日志"
            @click="emit('close')"
          >
            ✕
          </button>
        </header>
        <div class="dialog-body">
          <AuditPanel :active="true" />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 32px;
  background: rgba(16, 24, 40, 0.3);
}

.dialog {
  display: flex;
  width: min(720px, calc(100vw - 64px));
  height: min(680px, calc(100vh - 64px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}

.dialog-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.dialog-head h2 {
  margin: 0;
  font-size: 14px;
}

.icon-button {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.icon-button:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.dialog-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
</style>
