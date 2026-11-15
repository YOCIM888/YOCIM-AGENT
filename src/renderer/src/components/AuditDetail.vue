<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AuditEntry } from '@shared/audit'

const props = defineProps<{ entry: AuditEntry }>()
const emit = defineEmits<{ close: [] }>()

const copied = ref(false)

const approvalText = computed(() => {
  if (props.entry.approval === 'approved') return '已批准'
  if (props.entry.approval === 'denied') return '已拒绝'
  return '免审批'
})

const timeText = computed(() => new Date(props.entry.ts).toLocaleString())

function formatDuration(value: number | undefined): string {
  if (typeof value !== 'number') return '未记录'
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`
}

async function copyAll(): Promise<void> {
  const entry = props.entry
  const text = [
    `时间：${timeText.value}`,
    `工具：${entry.tool}`,
    `结果：${entry.ok ? '成功' : '失败'}`,
    `审批：${approvalText.value}`,
    `会话：${entry.sessionId}`,
    `runId：${entry.runId}`,
    `callId：${entry.callId ?? '未记录'}`,
    `耗时：${formatDuration(entry.durationMs)}`,
    '',
    `参数摘要：${entry.argsSummary}`,
    `结果摘要：${entry.resultSummary}`
  ].join('\n')
  const result = await window.yocim.clipboard.writeText({ text: text.slice(0, 4096) })
  if (result.ok) {
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  }
}
</script>

<template>
  <div class="drawer-mask" data-testid="audit-detail-mask" @click.self="emit('close')">
    <aside class="drawer" data-testid="audit-detail">
      <header>
        <h2>{{ entry.tool }}</h2>
        <button type="button" class="close" data-testid="audit-detail-close" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="badges">
        <span class="badge" :class="{ failed: !entry.ok }">{{ entry.ok ? '成功' : '失败' }}</span>
        <span class="badge" :class="{ denied: entry.approval === 'denied' }">
          {{ approvalText }}
        </span>
      </div>

      <dl>
        <dt>时间</dt>
        <dd>{{ timeText }}</dd>
        <dt>耗时</dt>
        <dd>{{ formatDuration(entry.durationMs) }}</dd>
        <dt>会话</dt>
        <dd class="mono">{{ entry.sessionId }}</dd>
        <dt>runId</dt>
        <dd class="mono">{{ entry.runId }}</dd>
        <dt>callId</dt>
        <dd class="mono">{{ entry.callId ?? '未记录' }}</dd>
      </dl>

      <h3>参数摘要</h3>
      <pre data-testid="audit-detail-args">{{ entry.argsSummary || '（空）' }}</pre>

      <h3>结果</h3>
      <pre data-testid="audit-detail-result">{{ entry.resultSummary || '（空）' }}</pre>

      <footer>
        <button type="button" data-testid="audit-detail-copy" @click="copyAll">
          {{ copied ? '已复制' : '复制全部' }}
        </button>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: flex-end;
  background: rgba(16, 24, 40, 0.24);
}

.drawer {
  display: flex;
  flex-direction: column;
  width: min(420px, 92vw);
  height: 100%;
  padding: 14px 18px 18px;
  overflow: auto;
  border-left: 1px solid var(--border);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}

header {
  display: flex;
  align-items: center;
  gap: 8px;
}

h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  flex: none;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}

.close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.badges {
  display: flex;
  gap: 6px;
  margin: 10px 0 4px;
}

.badge {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--success);
  font-size: 11px;
}

.badge.failed,
.badge.denied {
  color: var(--danger);
}

dl {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 4px 10px;
  margin: 12px 0 0;
  font-size: 11.5px;
}

dt {
  color: var(--text-muted);
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.mono {
  font-family: var(--font-mono);
  font-size: 10.5px;
}

h3 {
  margin: 14px 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  text-transform: uppercase;
}

pre {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}

footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

footer button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

footer button:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
