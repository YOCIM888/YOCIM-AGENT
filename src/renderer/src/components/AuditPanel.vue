<script setup lang="ts">
import { t } from '../i18n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AuditEntry } from '@shared/audit'
import { useAuditStore } from '../stores/audit'
import { useSessionStore } from '../stores/session'
import AuditDetail from './AuditDetail.vue'

const props = defineProps<{ active: boolean }>()

const sessions = useSessionStore()
const audit = useAuditStore()

const showFilters = ref(false)
const keywordInput = ref('')
let keywordTimer: ReturnType<typeof setTimeout> | null = null
let liveTimer: ReturnType<typeof setInterval> | null = null

const canScopeSession = computed(() => Boolean(sessions.activeSessionId))
const entryCount = computed(() => `${audit.entries.length} / ${audit.total}`)

function formatTime(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const time = date.toLocaleTimeString('zh-CN', { hour12: false })
  if (sameDay) return time
  const day = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `${day} ${time.slice(0, 5)}`
}

function approvalLabel(value: AuditEntry['approval']): string {
  if (value === 'approved') return t('已批准')
  if (value === 'denied') return t('已拒绝')
  return t('免审批')
}

function scheduleKeyword(value: string): void {
  keywordInput.value = value
  if (keywordTimer) clearTimeout(keywordTimer)
  keywordTimer = setTimeout(() => {
    keywordTimer = null
    void audit.setFilter({ keyword: value })
  }, 300)
}

function stopLive(): void {
  if (!liveTimer) return
  clearInterval(liveTimer)
  liveTimer = null
}

function syncLive(): void {
  stopLive()
  if (!audit.live || !props.active) return
  // 实时模式：2.5s 静默刷新首页，运行中自动带出新条目
  liveTimer = setInterval(() => {
    void audit.refresh({ silent: true })
  }, 2500)
}

async function toggleLive(): Promise<void> {
  audit.setLive(!audit.live)
  syncLive()
}

async function setScope(next: 'session' | 'all'): Promise<void> {
  if (next === 'session' && !canScopeSession.value) return
  await audit.setScope(next)
}

watch(
  () => props.active,
  (active) => {
    if (active) void audit.refresh()
    syncLive()
  }
)

watch(
  () => sessions.activeSessionId,
  (sessionId) => {
    if (!sessionId && audit.scope === 'session') {
      void audit.setScope('all')
      return
    }
    if (props.active) void audit.refresh()
  }
)

onMounted(() => {
  if (props.active) void audit.refresh()
  syncLive()
})

onBeforeUnmount(() => {
  if (keywordTimer) clearTimeout(keywordTimer)
  stopLive()
})
</script>

<template>
  <div class="audit" data-testid="audit-panel">
    <div class="audit-head">
      <span class="title">{{ t('审计') }}</span>
      <div class="scope">
        <button
          type="button"
          :class="{ active: audit.scope === 'session' }"
          :disabled="!canScopeSession"
          data-testid="audit-scope-session"
          @click="setScope('session')"
        >
          {{ t('当前会话') }}
        </button>
        <button
          type="button"
          :class="{ active: audit.scope === 'all' }"
          data-testid="audit-scope-all"
          @click="setScope('all')"
        >
          {{ t('全部') }}
        </button>
      </div>
      <button
        type="button"
        class="icon"
        :class="{ on: audit.live }"
        :title="audit.live ? t('实时刷新中（点击暂停）') : t('开启实时刷新')"
        data-testid="audit-live"
        @click="toggleLive"
      >
        <span class="dot"></span>
      </button>
      <button
        type="button"
        class="icon"
        :title="t('刷新')"
        :disabled="audit.loading"
        data-testid="audit-refresh"
        @click="audit.refresh()"
      >
        ↻
      </button>
    </div>

    <div class="stats" data-testid="audit-stats">
      <div class="stat">
        <b data-testid="audit-stat-total">{{ audit.stats?.total ?? 0 }}</b>
        <span>{{ t('总调用') }}</span>
      </div>
      <div class="stat danger">
        <b data-testid="audit-stat-failed">{{ audit.stats?.failed ?? 0 }}</b>
        <span>{{ t('失败') }}</span>
      </div>
      <div class="stat">
        <b data-testid="audit-stat-approved">{{ audit.stats?.approved ?? 0 }}</b>
        <span>{{ t('批准') }}</span>
      </div>
      <div class="stat danger">
        <b data-testid="audit-stat-denied">{{ audit.stats?.denied ?? 0 }}</b>
        <span>{{ t('拒绝') }}</span>
      </div>
    </div>

    <div class="query-row">
      <input
        :value="keywordInput"
        type="text"
        class="keyword"
        :placeholder="t('搜索工具 / 参数 / 结果')"
        data-testid="audit-keyword"
        :aria-label="t('审计关键字')"
        @input="scheduleKeyword(($event.target as HTMLInputElement).value)"
      />
      <button
        type="button"
        class="icon"
        :class="{ on: showFilters || audit.hasFilters }"
        :title="t('筛选')"
        data-testid="audit-filters-toggle"
        @click="showFilters = !showFilters"
      >
        ⋯
      </button>
    </div>

    <div v-if="showFilters" class="filters" data-testid="audit-filters">
      <label>
        {{ t('工具') }}
        <select
          :value="audit.tool"
          data-testid="audit-filter-tool"
          @change="audit.setFilter({ tool: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">{{ t('全部') }}</option>
          <option v-for="name in audit.tools" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <label>
        {{ t('结果') }}
        <select
          :value="audit.result"
          data-testid="audit-filter-result"
          @change="
            audit.setFilter({
              result: ($event.target as HTMLSelectElement).value as '' | 'ok' | 'failed'
            })
          "
        >
          <option value="">{{ t('全部') }}</option>
          <option value="ok">{{ t('成功') }}</option>
          <option value="failed">{{ t('失败') }}</option>
        </select>
      </label>
      <label>
        {{ t('审批') }}
        <select
          :value="audit.approval"
          data-testid="audit-filter-approval"
          @change="
            audit.setFilter({
              approval: ($event.target as HTMLSelectElement).value as
                '' | 'not_required' | 'approved' | 'denied'
            })
          "
        >
          <option value="">{{ t('全部') }}</option>
          <option value="not_required">{{ t('免审批') }}</option>
          <option value="approved">{{ t('已批准') }}</option>
          <option value="denied">{{ t('已拒绝') }}</option>
        </select>
      </label>
      <label>
        {{ t('时间') }}
        <select
          :value="audit.range"
          data-testid="audit-filter-range"
          @change="
            audit.setFilter({
              range: ($event.target as HTMLSelectElement).value as 'all' | 'today' | 'week'
            })
          "
        >
          <option value="all">{{ t('全部') }}</option>
          <option value="today">{{ t('今天') }}</option>
          <option value="week">{{ t('最近 7 天') }}</option>
        </select>
      </label>
      <button
        type="button"
        class="clear"
        data-testid="audit-clear-filters"
        :disabled="!audit.hasFilters && !audit.keyword"
        @click="
          () => {
            keywordInput = ''
            audit.clearFilters()
          }
        "
      >
        {{ t('重置筛选') }}
      </button>
    </div>

    <div class="list-head">
      <span class="count" data-testid="audit-count">{{ entryCount }}</span>
      <div class="exports">
        <button
          type="button"
          class="export"
          data-testid="audit-export-json"
          :disabled="!audit.total"
          @click="audit.exportTo('json')"
        >
          JSON
        </button>
        <button
          type="button"
          class="export"
          data-testid="audit-export-csv"
          :disabled="!audit.total"
          @click="audit.exportTo('csv')"
        >
          CSV
        </button>
      </div>
    </div>

    <p v-if="audit.error" class="error" data-testid="audit-error">{{ t(audit.error) }}</p>
    <p v-else-if="audit.notice" class="notice" data-testid="audit-notice">{{ t(audit.notice) }}</p>

    <p v-if="audit.loading" class="empty">{{ t('加载中…') }}</p>
    <p v-else-if="!audit.entries.length" class="empty" data-testid="audit-empty">
      {{ t('暂无审计记录。') }}
    </p>
    <ul v-else class="list">
      <li
        v-for="entry in audit.entries"
        :key="entry.id"
        class="row"
        :class="{ failed: !entry.ok }"
        :data-testid="`audit-row-${entry.id}`"
        @click="audit.openDetail(entry)"
      >
        <span class="time">{{ formatTime(entry.ts) }}</span>
        <span class="tool">{{ entry.tool }}</span>
        <span class="approval" :class="{ denied: entry.approval === 'denied' }">
          {{ approvalLabel(entry.approval) }}
        </span>
        <span class="summary">{{ entry.resultSummary }}</span>
      </li>
    </ul>

    <button
      v-if="audit.hasMore"
      type="button"
      class="more"
      data-testid="audit-load-more"
      :disabled="audit.loadingMore"
      @click="audit.loadMore()"
    >
      {{
        audit.loadingMore
          ? t('加载中…')
          : `加载更多（已显示 ${audit.entries.length} / ${audit.total}）`
      }}
    </button>

    <AuditDetail v-if="audit.detail" :entry="audit.detail" @close="audit.closeDetail()" />
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
  gap: 6px;
  padding-bottom: 8px;
}

.title {
  font-size: 12px;
  font-weight: 600;
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

.icon {
  display: grid;
  place-items: center;
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

.icon:hover,
.icon.on {
  background: var(--accent-soft);
  color: var(--accent);
}

.icon .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border-strong);
}

.icon.on .dot {
  background: var(--success);
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  padding-bottom: 8px;
}

.stat {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.stat b {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
}

.stat span {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}

.stat.danger b {
  color: var(--danger);
}

.query-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-bottom: 6px;
}

.keyword {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
}

.filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 8px;
  padding: 6px 0 8px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
}

.filters label {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.filters select {
  flex: 1;
  min-width: 0;
  padding: 3px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 11px;
}

.clear {
  grid-column: span 2;
  justify-self: start;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.clear:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.clear:disabled {
  opacity: 0.45;
  cursor: default;
}

.list-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0 6px;
  border-bottom: 1px solid var(--border);
}

.count {
  flex: 1;
  color: var(--text-muted);
  font-size: 10.5px;
}

.exports {
  display: flex;
  gap: 4px;
}

.export {
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}

.export:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.export:disabled {
  opacity: 0.4;
  cursor: default;
}

.error,
.notice,
.empty {
  margin: 0;
  padding: 6px 0;
  font-size: 11.5px;
}

.error {
  color: var(--danger);
}

.notice {
  color: var(--success);
}

.empty {
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
  gap: 2px 8px;
  padding: 6px 2px;
  border-bottom: 1px solid var(--border);
  font-size: 11.5px;
  cursor: pointer;
}

.row:hover {
  background: var(--bg-hover);
}

.row.failed .tool {
  color: var(--danger);
}

.time,
.approval {
  color: var(--text-muted);
}

.approval.denied {
  color: var(--danger);
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

.more {
  flex: none;
  margin-top: 8px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.more:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.more:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
