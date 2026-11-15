<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { AuditEntry } from '@shared/audit'
import { useSessionStore } from '../stores/session'

const sessions = useSessionStore()
const props = defineProps<{ active: boolean }>()
const entries = ref<AuditEntry[]>([])
const error = ref('')
const loading = ref(false)
const scope = ref<'session' | 'all'>(sessions.activeSessionId ? 'session' : 'all')

const canScopeSession = computed(() => Boolean(sessions.activeSessionId))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result =
      scope.value === 'session' && sessions.activeSessionId
        ? await window.yocim.audit.list({
            sessionId: sessions.activeSessionId,
            limit: 50
          })
        : await window.yocim.audit.list({ limit: 50 })
    if (result.ok) {
      entries.value = result.data
    } else {
      error.value = result.error.message
    }
  } finally {
    loading.value = false
  }
}

async function setScope(next: 'session' | 'all'): Promise<void> {
  if (next === 'session' && !canScopeSession.value) return
  scope.value = next
  await load()
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

function approvalLabel(value: AuditEntry['approval']): string {
  if (value === 'approved') return '已批准'
  if (value === 'denied') return '已拒绝'
  return '免审批'
}

watch(
  () => sessions.activeSessionId,
  (sessionId) => {
    if (!sessionId) scope.value = 'all'
    void load()
  }
)

watch(
  () => props.active,
  (active) => {
    if (active) void load()
  }
)

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="audit" data-testid="audit-panel">
    <div class="audit-head">
      <span>审计</span>
      <div class="scope">
        <button
          type="button"
          :class="{ active: scope === 'session' }"
          :disabled="!canScopeSession"
          data-testid="audit-scope-session"
          @click="setScope('session')"
        >
          当前会话
        </button>
        <button
          type="button"
          :class="{ active: scope === 'all' }"
          data-testid="audit-scope-all"
          @click="setScope('all')"
        >
          全部
        </button>
      </div>
      <button
        type="button"
        class="refresh"
        :disabled="loading"
        data-testid="audit-refresh"
        @click="load"
      >
        ↻
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!entries.length" class="empty">暂无审计记录。</p>
    <ul v-else class="list">
      <li v-for="entry in entries" :key="entry.id" class="row" :class="{ failed: !entry.ok }">
        <span class="time">{{ formatTime(entry.ts) }}</span>
        <span class="tool">{{ entry.tool }}</span>
        <span class="approval">{{ approvalLabel(entry.approval) }}</span>
        <span class="summary">{{ entry.resultSummary }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.audit {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 10px 12px 12px;
  overflow: hidden;
}

.audit-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.scope {
  display: flex;
  gap: 2px;
  margin-left: auto;
}

.scope button {
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.scope button.active {
  border-color: var(--border);
  background: var(--bg);
  color: var(--text);
}

.scope button:disabled {
  opacity: 0.4;
  cursor: default;
}

.refresh {
  width: 22px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.refresh:hover {
  background: var(--bg-hover);
  color: var(--accent);
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.list {
  flex: 1;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  font-size: 11.5px;
}

.row.failed .tool {
  color: var(--danger);
}

.time,
.approval {
  color: var(--text-muted);
}

.tool {
  color: var(--accent);
}

.summary {
  flex-basis: 100%;
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
