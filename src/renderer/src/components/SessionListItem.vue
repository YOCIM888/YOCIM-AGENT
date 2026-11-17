<script setup lang="ts">
import { t } from '../i18n'
import { computed, ref } from 'vue'
import type { SessionSummary } from '@shared/session'
import type { ContextMenuItem } from '../lib/menu'
import { useChatStore } from '../stores/chat'
import { useSessionStore } from '../stores/session'
import ContextMenu from './ContextMenu.vue'

const props = defineProps<{
  session: SessionSummary
  active: boolean
}>()

const emit = defineEmits<{
  select: []
  move: []
}>()

const sessions = useSessionStore()
const chat = useChatStore()

const editing = ref(false)
const editingTitle = ref('')
const confirmingDelete = ref(false)
const menu = ref<{ x: number; y: number } | null>(null)

const menuItems = computed<ContextMenuItem[]>(() => [
  { id: 'rename', label: t('重命名'), testid: 'session-rename' },
  { id: 'export', label: t('导出 Markdown'), testid: 'session-export' },
  {
    id: 'pin',
    label: props.session.pinnedAt ? t('取消置顶') : t('置顶'),
    testid: 'session-pin'
  },
  {
    id: 'archive',
    label: props.session.archivedAt ? t('取消归档') : t('归档'),
    testid: 'session-archive'
  },
  {
    id: 'move',
    label: t('移动到项目…'),
    testid: 'session-move',
    separatorBefore: true
  },
  {
    id: 'delete',
    label: confirmingDelete.value ? t('再次点击确认删除') : t('删除会话'),
    testid: 'session-delete',
    danger: true,
    separatorBefore: true
  }
])

function formatTime(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' })
}

function openMenu(event: MouseEvent): void {
  confirmingDelete.value = false
  menu.value = { x: event.clientX, y: event.clientY }
}

function startRename(): void {
  editing.value = true
  editingTitle.value = props.session.title
}

async function commitRename(): Promise<void> {
  if (!editing.value) return
  editing.value = false
  const title = editingTitle.value.trim()
  if (!title || title === props.session.title) return
  await sessions.renameSession(props.session.id, title)
}

async function exportSession(): Promise<void> {
  const result = await window.yocim.sessions.exportToFile({ sessionId: props.session.id })
  if (!result.ok) {
    chat.appendSystem(t('导出失败：{error}', { error: result.error.message }), props.session.id)
    return
  }
  if (result.data.path) {
    chat.appendSystem(t('已导出会话到：{path}', { path: result.data.path }), props.session.id)
  }
}

async function togglePin(): Promise<void> {
  await sessions.pinSession(props.session.id, !props.session.pinnedAt)
}

async function toggleArchive(): Promise<void> {
  await sessions.archiveSession(props.session.id, !props.session.archivedAt)
}

async function removeSession(): Promise<void> {
  await sessions.removeSession(props.session.id)
}

async function selectMenu(id: string): Promise<void> {
  if (id === 'delete') {
    if (!confirmingDelete.value) {
      confirmingDelete.value = true
      return
    }
    confirmingDelete.value = false
    menu.value = null
    await removeSession()
    return
  }

  menu.value = null
  if (id === 'rename') {
    startRename()
  } else if (id === 'export') {
    await exportSession()
  } else if (id === 'pin') {
    await togglePin()
  } else if (id === 'archive') {
    await toggleArchive()
  } else if (id === 'move') {
    emit('move')
  }
}
</script>

<template>
  <li
    class="session-row"
    :class="{ active, archived: Boolean(session.archivedAt) }"
    :data-testid="active ? 'session-row-active' : `session-row-${session.id}`"
    @contextmenu.prevent.stop="openMenu"
  >
    <input
      v-if="editing"
      v-model="editingTitle"
      class="rename-input"
      data-testid="session-rename-input"
      @keydown.enter="commitRename"
      @keydown.esc="editing = false"
      @blur="commitRename"
    />
    <template v-else>
      <button
        type="button"
        class="main"
        data-testid="session-item"
        :title="t('右键查看更多操作')"
        @click="emit('select')"
      >
        <span v-if="session.pinnedAt" class="pin-mark">★</span>
        <span class="title">{{ session.title }}</span>
        <span class="meta">
          {{ formatTime(session.updatedAt) }}
          <template v-if="session.archivedAt"> {{ t('· 已归档') }}</template>
        </span>
      </button>

      <ContextMenu
        v-if="menu"
        :x="menu.x"
        :y="menu.y"
        :items="menuItems"
        @select="selectMenu"
        @close="menu = null"
      />
    </template>
  </li>
</template>

<style scoped>
.session-row {
  position: relative;
  margin-bottom: 1px;
  border-radius: var(--radius-sm);
}

.session-row:hover,
.session-row.active {
  background: var(--bg-hover);
}

.session-row.active {
  background: var(--accent-soft);
}

.session-row.archived {
  opacity: 0.62;
}

.main {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.pin-mark {
  flex: none;
  color: var(--warning);
  font-size: 10px;
}

.title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  flex: none;
  font-size: 10.5px;
  color: var(--text-muted);
}

.rename-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
</style>
