<script setup lang="ts">
import { t } from '../i18n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useBrowserStore } from '../stores/browser'
import { useSessionStore } from '../stores/session'
import { useAppSettingsStore } from '../stores/appSettings'
import { useSettingsStore } from '../stores/settings'

const emit = defineEmits<{ close: [] }>()

const sessions = useSessionStore()
const browser = useBrowserStore()
const appSettings = useAppSettingsStore()
const settings = useSettingsStore()

const sessionId = computed(() => sessions.activeSessionId)
const host = ref<HTMLDivElement | null>(null)
const activeLog = ref<'console' | 'network' | 'exception' | 'audit'>('console')
const observabilityOpen = ref(true)
const auditLimit = ref(100)
let observer: ResizeObserver | null = null

const logTabs = computed(
  () =>
    [
      { id: 'console', label: 'Console' },
      { id: 'network', label: 'Network' },
      { id: 'exception', label: t('异常') },
      { id: 'audit', label: t('审计') }
    ] as const
)

const canOperate = computed(
  () => Boolean(sessionId.value) && appSettings.browser.enabled && browser.connected
)
const statusLabel = computed(() => {
  switch (browser.status) {
    case 'ready':
      return browser.headless ? t('已连接·无头') : t('已连接')
    case 'connecting':
      return t('连接中')
    case 'reconnecting':
      return t('重连中')
    case 'error':
      return t('错误')
    case 'disposed':
      return t('已回收')
    default:
      return t('未启动')
  }
})

function formatTime(ts: number): string {
  const date = new Date(ts)
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

function levelClass(level: string): string {
  if (level === 'error') return 'level-error'
  if (level === 'warning') return 'level-warning'
  return 'level-info'
}

function statusClass(status: number | null, failure: string | null): string {
  if (failure) return 'net-failed'
  if (status === null) return 'net-pending'
  if (status >= 400) return 'net-failed'
  return 'net-ok'
}

async function syncViewport(): Promise<void> {
  if (!host.value || !sessionId.value) return
  // 折叠/展开可观测面板会改变 host 宽度，ResizeObserver 与此处都会重新定位原生视图
  const rect = host.value.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return
  await browser.reportViewport({
    sessionId: sessionId.value,
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    visible: true
  })
}

function hideViewport(): void {
  if (!sessionId.value) return
  void browser.reportViewport({
    sessionId: sessionId.value,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    visible: false
  })
}

async function submitNavigate(): Promise<void> {
  if (!sessionId.value || !browser.urlDraft.trim()) return
  await browser.navigate(sessionId.value, browser.urlDraft.trim())
}

function setMode(mode: 'paused' | 'human' | 'ai'): void {
  if (!sessionId.value) return
  void browser.control(sessionId.value, mode)
}

onMounted(async () => {
  browser.subscribe()
  if (sessionId.value) await browser.loadState(sessionId.value)
  observer = new ResizeObserver(() => void syncViewport())
  if (host.value) observer.observe(host.value)
  window.addEventListener('resize', syncViewport)
})

onBeforeUnmount(() => {
  hideViewport()
  observer?.disconnect()
  window.removeEventListener('resize', syncViewport)
})

watch(sessionId, async (next, previous) => {
  if (previous && previous !== next) hideViewport()
  if (next) await browser.loadState(next)
  else browser.reset(null)
})

watch(observabilityOpen, () => void syncViewport())

watch(
  () => settings.theme,
  () => void syncViewport()
)
</script>

<template>
  <section class="browser-panel" data-testid="browser-panel">
    <header class="browser-toolbar">
      <button
        type="button"
        class="close-button"
        data-testid="browser-close"
        :title="t('关闭浏览器视图')"
        :aria-label="t('关闭浏览器视图')"
        @click="emit('close')"
      >
        ✕
      </button>
      <span class="browser-title">{{ t('浏览器') }}</span>
      <span class="status-badge" :class="`status-${browser.status}`" data-testid="browser-status">
        {{ statusLabel }}
      </span>
      <form class="address-bar" @submit.prevent="submitNavigate">
        <input
          v-model="browser.urlDraft"
          type="text"
          data-testid="browser-url"
          :placeholder="t('输入 http/https 地址，回车导航（人类操作）')"
          :disabled="!canOperate"
        />
        <button type="submit" class="sp-btn sm" data-testid="browser-go" :disabled="!canOperate">
          {{ t('前往') }}
        </button>
      </form>
      <div class="control-group" data-testid="browser-controls">
        <button
          type="button"
          class="sp-btn sm"
          :class="{ primary: browser.mode === 'paused' }"
          data-testid="browser-pause"
          :disabled="!canOperate"
          @click="setMode('paused')"
        >
          {{ t('暂停 AI') }}
        </button>
        <button
          type="button"
          class="sp-btn sm"
          :class="{ primary: browser.mode === 'human' }"
          data-testid="browser-takeover"
          :disabled="!canOperate"
          @click="setMode('human')"
        >
          {{ t('接管') }}
        </button>
        <button
          type="button"
          class="sp-btn sm"
          :class="{ primary: browser.mode === 'ai' }"
          data-testid="browser-resume"
          :disabled="!canOperate"
          @click="setMode('ai')"
        >
          {{ t('恢复 AI') }}
        </button>
        <button
          type="button"
          class="sp-btn sm ghost"
          data-testid="browser-retry"
          :disabled="!sessionId || !appSettings.browser.enabled"
          @click="sessionId && browser.retry(sessionId)"
        >
          {{ t('重试') }}
        </button>
        <button
          type="button"
          class="sp-btn sm ghost"
          data-testid="browser-toggle-observability"
          :aria-expanded="observabilityOpen"
          @click="observabilityOpen = !observabilityOpen"
        >
          {{ observabilityOpen ? t('收起控制台') : t('展开控制台') }}
        </button>
      </div>
    </header>

    <p v-if="browser.error" class="browser-error" data-testid="browser-error">
      {{ t(browser.error) }}
    </p>

    <div class="browser-body">
      <div class="browser-viewport-wrap">
        <div ref="host" class="browser-host" data-testid="browser-host">
          <div v-if="!sessionId" class="empty-state">
            {{ t('请先选择一个会话，再打开浏览器。') }}
          </div>
          <div v-else-if="!appSettings.browser.enabled" class="empty-state">
            {{ t('浏览器能力已在设置中关闭。') }}
          </div>
          <div v-else-if="browser.status === 'error'" class="empty-state">
            <span>{{ t('浏览器启动或 CDP 连接失败。') }}</span>
            <button type="button" class="sp-btn sm" @click="sessionId && browser.retry(sessionId)">
              {{ t('重新连接') }}
            </button>
          </div>
          <div v-else-if="browser.headless" class="empty-state">
            {{ t('无头模式：页面在后台运行，可通过控制台观察与 CDP 截图查看。') }}
          </div>
        </div>
      </div>

      <aside v-show="observabilityOpen" class="observability" data-testid="browser-observability">
        <nav class="log-tabs" :aria-label="t('可观测面板')">
          <button
            v-for="tab in logTabs"
            :key="tab.id"
            type="button"
            class="log-tab"
            :class="{ active: activeLog === tab.id }"
            :data-testid="`browser-log-${tab.id}`"
            @click="activeLog = tab.id"
          >
            {{ tab.label }}
            <span v-if="tab.id === 'console'" class="tab-count">{{
              browser.consoleEntries.length
            }}</span>
            <span v-else-if="tab.id === 'network'" class="tab-count">{{
              browser.networkEntries.length
            }}</span>
            <span v-else-if="tab.id === 'exception'" class="tab-count">{{
              browser.exceptions.length
            }}</span>
          </button>
        </nav>

        <div class="log-body" data-testid="browser-log-body">
          <template v-if="activeLog === 'console'">
            <p v-if="!browser.consoleEntries.length" class="sp-empty">
              {{ t('暂无 Console 消息') }}
            </p>
            <div v-for="entry in browser.consoleEntries" :key="entry.id" class="log-row">
              <span class="log-time">{{ formatTime(entry.ts) }}</span>
              <span class="log-level" :class="levelClass(entry.level)">{{ entry.level }}</span>
              <span class="log-text" :title="entry.text">{{ entry.text }}</span>
              <span class="log-source" :title="entry.source">{{ entry.source }}</span>
            </div>
          </template>

          <template v-else-if="activeLog === 'network'">
            <p v-if="!browser.networkEntries.length" class="sp-empty">{{ t('暂无网络请求') }}</p>
            <div v-for="entry in browser.networkEntries" :key="entry.id" class="log-row net-row">
              <span class="log-time">{{ formatTime(entry.ts) }}</span>
              <span class="net-status" :class="statusClass(entry.status, entry.failure)">
                {{ entry.failure ? 'FAIL' : (entry.status ?? '…') }}
              </span>
              <span class="net-method">{{ entry.method }}</span>
              <span class="net-url" :title="entry.url">{{ entry.url }}</span>
              <span class="net-duration">{{ entry.durationMs ?? 0 }}ms</span>
            </div>
            <p class="sp-hint">{{ t('Authorization / Cookie 等敏感头已脱敏，不进入事件流。') }}</p>
          </template>

          <template v-else-if="activeLog === 'exception'">
            <p v-if="!browser.exceptions.length" class="sp-empty">{{ t('暂无未处理异常') }}</p>
            <div v-for="entry in browser.exceptions" :key="entry.id" class="log-row exception-row">
              <span class="log-time">{{ formatTime(entry.ts) }}</span>
              <div class="exception-detail">
                <strong>{{ entry.text }}</strong>
                <pre v-if="entry.stack">{{ entry.stack }}</pre>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="audit-tools">
              <label>
                {{ t('最近') }}
                <input
                  v-model.number="auditLimit"
                  type="number"
                  min="1"
                  max="200"
                  class="audit-limit"
                />
                {{ t('条') }}
              </label>
              <button
                type="button"
                class="sp-btn sm"
                :disabled="!sessionId"
                @click="sessionId && browser.loadAudit(sessionId, auditLimit)"
              >
                {{ t('查询审计日志') }}
              </button>
            </div>
            <p v-if="!browser.auditEntries.length" class="sp-empty">{{ t('暂无操作审计') }}</p>
            <div v-for="entry in browser.auditEntries" :key="entry.id" class="log-row audit-row">
              <span class="log-time">{{ formatTime(entry.ts) }}</span>
              <span
                class="audit-source"
                :class="entry.source === 'ai' ? 'source-ai' : 'source-human'"
              >
                {{ entry.source === 'ai' ? 'AI' : t('人') }}
              </span>
              <div class="audit-detail">
                <strong :class="{ 'audit-failed': !entry.ok }">{{ entry.method }}</strong>
                <span v-if="entry.intent" class="audit-intent"
                  >{{ t('意图：') }}{{ entry.intent }}</span
                >
                <span class="audit-params">{{ entry.params }}</span>
                <span v-if="entry.stepId" class="audit-step"
                  >{{ t('步骤') }} {{ entry.stepId }}</span
                >
                <span v-if="entry.error" class="audit-error">{{ t(entry.error) }}</span>
              </div>
            </div>
          </template>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.browser-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
}

.browser-toolbar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.close-button {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.close-button:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.browser-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
}

.status-badge {
  padding: 2px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  font-size: 10px;
  color: var(--text-muted);
}
.status-ready {
  border-color: color-mix(in srgb, var(--success) 45%, var(--border));
  background: var(--success-soft);
  color: var(--success);
}
.status-error {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  background: var(--danger-soft);
  color: var(--danger);
}
.status-connecting,
.status-reconnecting {
  border-color: color-mix(in srgb, var(--warning) 45%, var(--border));
  background: var(--warning-soft);
  color: var(--warning);
}

.address-bar {
  display: flex;
  flex: 1;
  min-width: 220px;
  gap: 4px;
}
.address-bar input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
}
.address-bar input:disabled {
  opacity: 0.5;
}

.control-group {
  display: flex;
  gap: 4px;
}

.browser-error {
  flex: none;
  margin: 0;
  padding: 5px 12px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11px;
}

.browser-body {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.browser-viewport-wrap {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.browser-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.empty-state {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.observability {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 340px;
  min-width: 220px;
  max-width: 50%;
  border-left: 1px solid var(--border-strong);
  background: var(--bg-subtle);
}

.log-tabs {
  display: flex;
  flex: none;
  border-bottom: 1px solid var(--border);
}
.log-tab {
  flex: 1;
  padding: 6px 4px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.log-tab.active {
  border-bottom-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.tab-count {
  margin-left: 3px;
  color: var(--text-muted);
  font-size: 9.5px;
}

.log-body {
  flex: 1;
  overflow: auto;
  padding: 4px 0;
}

.log-row {
  display: flex;
  gap: 6px;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--text);
}
.log-time {
  flex: none;
  color: var(--text-muted);
}
.log-level {
  flex: none;
  width: 44px;
  text-transform: uppercase;
}
.level-error {
  color: var(--danger);
}
.level-warning {
  color: var(--warning);
}
.level-info {
  color: var(--accent);
}
.log-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.log-source {
  flex: none;
  max-width: 90px;
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.net-status {
  flex: none;
  width: 38px;
  font-weight: 600;
}
.net-ok {
  color: var(--success);
}
.net-failed {
  color: var(--danger);
}
.net-pending {
  color: var(--text-muted);
}
.net-method {
  flex: none;
  width: 42px;
  color: var(--accent);
}
.net-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.net-duration {
  flex: none;
  color: var(--text-muted);
}

.exception-row {
  flex-direction: column;
  gap: 2px;
}
.exception-detail strong {
  color: var(--danger);
}
.exception-detail pre {
  margin: 0;
  overflow-x: auto;
  white-space: pre-wrap;
  color: var(--text-muted);
}

.audit-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.audit-limit {
  width: 52px;
  padding: 2px 4px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
}
.audit-row {
  align-items: flex-start;
}
.audit-source {
  flex: none;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
}
.source-ai {
  background: var(--accent-soft);
  color: var(--accent);
}
.source-human {
  background: var(--success-soft);
  color: var(--success);
}
.audit-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.audit-failed {
  color: var(--danger);
}
.audit-intent {
  color: var(--text);
}
.audit-params,
.audit-step,
.audit-error {
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.audit-error {
  color: var(--danger);
}
</style>
