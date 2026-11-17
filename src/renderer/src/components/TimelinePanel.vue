<script setup lang="ts">
import { t } from '../i18n'
import { computed, ref, watch } from 'vue'
import type { TimelineEntry, TimelineSource } from '@shared/ipc'
import { languageForPath } from '../lib/language'
import { useWorkspaceStore } from '../stores/workspace'
import CollapsibleSection from './CollapsibleSection.vue'
import ConfirmDialog from './ConfirmDialog.vue'

const workspace = useWorkspaceStore()
const entries = ref<TimelineEntry[]>([])
const loading = ref(false)
const error = ref('')
const pendingRestore = ref<TimelineEntry | null>(null)

const SOURCE_LABEL = computed<Record<TimelineSource, string>>(() => ({
  user: t('用户'),
  agent: 'Agent',
  external: t('外部')
}))

async function load(): Promise<void> {
  const file = workspace.activeFile
  if (!file) {
    entries.value = []
    return
  }
  loading.value = true
  error.value = ''
  const result = await window.yocim.timeline.list({ relativePath: file.relativePath })
  loading.value = false
  if (result.ok) entries.value = result.data
  else error.value = result.error.message
}

watch(() => [workspace.activeFile?.relativePath, workspace.timelineVersion], load, {
  immediate: true
})

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`
}

async function openDiff(entry: TimelineEntry): Promise<void> {
  const file = workspace.activeFile
  if (!file) return
  error.value = ''
  const result = await window.yocim.timeline.read({ id: entry.id })
  if (!result.ok) {
    error.value = result.error.message
    return
  }
  workspace.openDiff({
    title: `${file.relativePath} · ${formatTime(entry.createdAt)}`,
    relativePath: file.relativePath,
    language: languageForPath(file.relativePath),
    original: result.data.content,
    modified: file.content
  })
}

async function confirmRestore(): Promise<void> {
  const entry = pendingRestore.value
  pendingRestore.value = null
  if (!entry) return
  error.value = ''
  const result = await window.yocim.timeline.restore({ id: entry.id })
  if (!result.ok) {
    error.value = result.error.message
    return
  }
  await workspace.reloadActiveFile()
  await load()
}
</script>

<template>
  <div class="timeline-wrap">
    <CollapsibleSection
      :title="t('时间线')"
      section="timeline"
      testid="timeline-section"
      :count="entries.length"
    >
      <p v-if="!workspace.activeFile" class="empty" data-testid="timeline-empty-file">
        {{ t('打开文件后显示历史') }}
      </p>
      <p v-else-if="loading" class="empty">{{ t('加载中…') }}</p>
      <p v-else-if="error" class="empty error" data-testid="timeline-error">{{ t(error) }}</p>
      <p v-else-if="!entries.length" class="empty" data-testid="timeline-empty">
        {{ t('暂无本地历史') }}
      </p>
      <ul v-else class="entries">
        <li
          v-for="entry in entries"
          :key="entry.id"
          class="entry"
          :data-testid="`timeline-entry-${entry.id}`"
        >
          <button
            type="button"
            class="entry-main"
            :title="t('与当前文件对比 · {time}', { time: formatTime(entry.createdAt) })"
            @click="openDiff(entry)"
          >
            <span class="source" :data-source="entry.source">{{ SOURCE_LABEL[entry.source] }}</span>
            <span class="time">{{ formatTime(entry.createdAt) }}</span>
            <span class="size">{{ formatSize(entry.size) }}</span>
          </button>
          <button
            type="button"
            class="restore"
            :title="t('恢复此版本')"
            :data-testid="`timeline-restore-${entry.id}`"
            @click="pendingRestore = entry"
          >
            ⟲
          </button>
        </li>
      </ul>
    </CollapsibleSection>
    <ConfirmDialog
      v-if="pendingRestore"
      :title="t('恢复此版本')"
      :message="t('恢复将覆盖当前文件内容，并自动生成新的快照。确定恢复吗？')"
      :confirm-label="t('恢复此版本')"
      testid="restore-dialog"
      @confirm="confirmRestore"
      @close="pendingRestore = null"
    />
  </div>
</template>

<style scoped>
.timeline-wrap {
  flex: none;
}

.empty {
  margin: 0;
  padding: 10px 12px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.empty.error {
  color: var(--danger);
}

.entries {
  margin: 0;
  padding: 4px 0;
  list-style: none;
}

.entry {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 6px;
}

.entry:hover {
  background: var(--bg-hover);
}

.entry-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 4px 4px 4px 10px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}

.source {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10px;
}

.source[data-source='agent'] {
  color: #6d9eeb;
}

.source[data-source='user'] {
  color: #42b883;
}

.time {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.size {
  flex: none;
  font-size: 10px;
  color: var(--text-muted);
}

.restore {
  flex: none;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}

.restore:hover {
  background: var(--bg-elevated);
  color: var(--text);
}
</style>
