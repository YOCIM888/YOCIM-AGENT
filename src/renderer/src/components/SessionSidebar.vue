<script setup lang="ts">
import { t } from '../i18n'
import { computed, ref } from 'vue'
import type { ProjectSummary, SessionSummary } from '@shared/session'
import type { ContextMenuItem } from '../lib/menu'
import { useChatStore } from '../stores/chat'
import { useProjectsStore } from '../stores/projects'
import { useSessionStore } from '../stores/session'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'
import ConfirmDialog from './ConfirmDialog.vue'
import ContextMenu from './ContextMenu.vue'
import MoveSessionDialog from './MoveSessionDialog.vue'
import SessionListItem from './SessionListItem.vue'
import SidebarToolBar from './SidebarToolBar.vue'

const sessions = useSessionStore()
const projects = useProjectsStore()
const workspace = useWorkspaceStore()
const chat = useChatStore()
const settings = useSettingsStore()

const query = ref('')
const showArchived = ref(false)
const moveTarget = ref<SessionSummary | null>(null)
const editingProjectId = ref<string | null>(null)
const editingProjectName = ref('')
const projectMenu = ref<{ x: number; y: number; project: ProjectSummary } | null>(null)
const removeTarget = ref<ProjectSummary | null>(null)

const projectMenuItems = computed<ContextMenuItem[]>(() => [
  { id: 'new-session', label: t('在项目中新建会话'), testid: 'project-new-session' },
  { id: 'open', label: t('打开该项目'), testid: 'project-open' },
  { id: 'rename', label: t('重命名项目'), testid: 'project-rename', separatorBefore: true },
  {
    id: 'remove',
    label: t('移除该项目'),
    testid: 'project-remove',
    separatorBefore: true,
    danger: true
  }
])

interface SessionGroup {
  id: string
  name: string
  project: ProjectSummary | null
  sessions: SessionSummary[]
}

const visibleSessions = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return sessions.sessions.filter((session) => {
    if (!showArchived.value && session.archivedAt) return false
    if (keyword && !session.title.toLowerCase().includes(keyword)) return false
    return true
  })
})

const pinnedSessions = computed(() =>
  visibleSessions.value.filter((session) => session.pinnedAt && !session.archivedAt)
)

const groups = computed<SessionGroup[]>(() => {
  const pinnedIds = new Set(pinnedSessions.value.map((session) => session.id))
  const keyword = query.value.trim()

  const list: SessionGroup[] = projects.projects.map((project) => ({
    id: project.id,
    name: project.name,
    project,
    sessions: visibleSessions.value.filter(
      (session) => session.projectId === project.id && !pinnedIds.has(session.id)
    )
  }))

  const unassigned = visibleSessions.value.filter(
    (session) => !session.projectId && !pinnedIds.has(session.id)
  )
  if (unassigned.length) {
    list.push({ id: 'unassigned', name: t('未归属会话'), project: null, sessions: unassigned })
  }

  return keyword ? list.filter((group) => group.sessions.length > 0) : list
})

async function createSession(projectId?: string): Promise<void> {
  if (projectId) {
    const ok = await workspace.openProject(projectId)
    if (!ok) return
  }
  const id = await sessions.createSession(projectId)
  if (id) {
    await chat.loadSession(id)
    await projects.refresh()
  }
}

function createSessionFromHeader(): void {
  void createSession(sessions.activeSession?.projectId ?? undefined)
}

async function selectSession(session: SessionSummary): Promise<void> {
  if (session.projectId && session.workspaceRoot !== workspace.info?.root) {
    const ok = await workspace.openProject(session.projectId)
    if (!ok) return
  }
  sessions.selectSession(session.id)
  await chat.loadSession(session.id)
}

function isExpanded(group: SessionGroup): boolean {
  if (query.value.trim()) return true
  return group.project ? projects.isExpanded(group.project.id) : true
}

function toggleGroup(group: SessionGroup): void {
  if (editingProjectId.value === group.id) return
  if (group.project) projects.toggleExpanded(group.project.id)
}

function handleGroupKeydown(group: SessionGroup, event: KeyboardEvent): void {
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  toggleGroup(group)
}

function startProjectRename(project: ProjectSummary): void {
  editingProjectId.value = project.id
  editingProjectName.value = project.name
}

async function commitProjectRename(): Promise<void> {
  const projectId = editingProjectId.value
  if (!projectId) return
  editingProjectId.value = null
  const name = editingProjectName.value.trim()
  if (!name) return
  await projects.renameProject(projectId, name)
}

function openMove(session: SessionSummary): void {
  moveTarget.value = session
}

function openProjectMenu(event: MouseEvent, project: ProjectSummary): void {
  projectMenu.value = { x: event.clientX, y: event.clientY, project }
}

async function openProjectFolder(project: ProjectSummary): Promise<void> {
  const ok = await workspace.openProject(project.id, { revealFolder: true })
  if (ok) await projects.refresh()
}

const removeMessage = computed(() => {
  const project = removeTarget.value
  if (!project) return ''
  const count = sessions.sessions.filter((session) => session.projectId === project.id).length
  const running =
    chat.sending && sessions.activeSession?.projectId === project.id
      ? t('正在进行的对话会被取消。')
      : ''
  return t(
    '将从应用列表中移除“{name}”及其 {count} 个会话（含已归档）。{running}磁盘上的文件夹与文件不会被删除或修改。',
    {
      name: project.name,
      count,
      running
    }
  )
})

async function confirmRemoveProject(): Promise<void> {
  const project = removeTarget.value
  removeTarget.value = null
  if (!project) return

  const removedIds = sessions.sessions
    .filter((session) => session.projectId === project.id)
    .map((session) => session.id)
  if (chat.sending && sessions.activeSession?.projectId === project.id) {
    await chat.cancel()
  }
  const ok = await projects.removeProject(project.id)
  if (!ok) {
    workspace.setError(projects.error || t('移除项目失败'))
    return
  }
  chat.forgetSessions(removedIds)
  await sessions.refresh()
  if (sessions.activeSessionId) await chat.loadSession(sessions.activeSessionId)
}

function selectProjectMenu(id: string): void {
  const project = projectMenu.value?.project
  projectMenu.value = null
  if (!project) return
  if (id === 'new-session') {
    void createSession(project.id)
  } else if (id === 'open') {
    void openProjectFolder(project)
  } else if (id === 'rename') {
    startProjectRename(project)
  } else if (id === 'remove') {
    removeTarget.value = project
  }
}
</script>

<template>
  <aside
    class="session-panel"
    data-testid="session-sidebar"
    :style="{ width: `${settings.sessionWidth}px` }"
  >
    <div class="brand">
      <img class="brand-logo" src="/image/yocim.png" alt="YOCIM" />
      <span class="brand-name" data-testid="app-title">YOCIM AGENT</span>
    </div>

    <button
      type="button"
      class="new-session"
      data-testid="new-session"
      :title="t('新建会话 (Ctrl+N)')"
      @click="createSessionFromHeader"
    >
      <span class="plus">＋</span>
      {{ t('新会话') }}
    </button>

    <div class="search-row">
      <input
        v-model="query"
        class="search-input"
        type="search"
        :placeholder="t('搜索会话 (Ctrl+K)')"
        data-testid="session-search"
      />
      <button
        type="button"
        class="archive-toggle"
        :class="{ active: showArchived }"
        data-testid="archive-toggle"
        :title="showArchived ? t('隐藏已归档') : t('显示已归档')"
        @click="showArchived = !showArchived"
      >
        ▣
      </button>
    </div>

    <div class="section-head">
      <span>{{ t('工作区') }}</span>
      <span class="section-count">{{ projects.projects.length }}</span>
    </div>

    <div class="list-area">
      <section v-if="pinnedSessions.length" class="pinned" data-testid="pinned-section">
        <div class="section-label">{{ t('★ 置顶') }}</div>
        <ul class="session-list">
          <SessionListItem
            v-for="session in pinnedSessions"
            :key="session.id"
            :session="session"
            :active="session.id === sessions.activeSessionId"
            @select="selectSession(session)"
            @move="openMove(session)"
          />
        </ul>
      </section>

      <section
        v-for="group in groups"
        :key="group.id"
        class="project-group"
        data-testid="project-group"
      >
        <div
          class="project-header"
          :class="{ clickable: !!group.project }"
          data-testid="project-header"
          :role="group.project ? 'button' : undefined"
          :tabindex="group.project ? 0 : undefined"
          :aria-expanded="group.project ? isExpanded(group) : undefined"
          :title="group.project ? (isExpanded(group) ? t('折叠项目') : t('展开项目')) : undefined"
          @click="toggleGroup(group)"
          @keydown="handleGroupKeydown(group, $event)"
          @contextmenu.prevent.stop="group.project && openProjectMenu($event, group.project)"
        >
          <span class="folder-icon" aria-hidden="true">
            <svg
              v-if="isExpanded(group)"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
              />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
              />
            </svg>
          </span>
          <input
            v-if="editingProjectId === group.id"
            v-model="editingProjectName"
            class="project-rename-input"
            data-testid="project-rename-input"
            @click.stop
            @keydown.enter="commitProjectRename"
            @keydown.esc="editingProjectId = null"
            @blur="commitProjectRename"
          />
          <template v-else>
            <span class="project-name" :title="group.project?.root">{{ group.name }}</span>
            <span class="count">{{ group.sessions.length }}</span>
          </template>
        </div>

        <ul v-if="isExpanded(group)" class="session-list">
          <SessionListItem
            v-for="session in group.sessions"
            :key="session.id"
            :session="session"
            :active="session.id === sessions.activeSessionId"
            @select="selectSession(session)"
            @move="openMove(session)"
          />
          <li v-if="!group.sessions.length" class="group-empty">{{ t('暂无会话') }}</li>
        </ul>
      </section>

      <p v-if="!sessions.sessions.length && !projects.projects.length" class="empty">
        {{ t('选择工作区后，可在这里创建会话。') }}
      </p>
      <p v-else-if="!visibleSessions.length" class="empty">
        {{ query ? t('没有匹配的会话。') : t('暂无会话，点击“新建”开始。') }}
      </p>
    </div>

    <SidebarToolBar />

    <ContextMenu
      v-if="projectMenu"
      :x="projectMenu.x"
      :y="projectMenu.y"
      :items="projectMenuItems"
      @select="selectProjectMenu"
      @close="projectMenu = null"
    />

    <MoveSessionDialog
      v-if="moveTarget"
      :session="moveTarget"
      :projects="projects.projects"
      @close="moveTarget = null"
      @moved="moveTarget = null"
    />

    <ConfirmDialog
      v-if="removeTarget"
      :title="t('移除项目')"
      :message="removeMessage"
      :confirm-label="t('移除项目')"
      danger
      testid="remove-project-dialog"
      @close="removeTarget = null"
      @confirm="confirmRemoveProject"
    />
  </aside>
</template>

<style scoped>
.session-panel {
  display: flex;
  flex: none;
  flex-direction: column;
  max-width: 45vw;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-subtle);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px 6px;
}

.brand-logo {
  width: 22px;
  height: 22px;
  padding: 1px;
  border-radius: 6px;
  background: #ffffff;
  object-fit: contain;
}

.brand-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.4px;
}

.new-session {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 4px 10px 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.new-session:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.plus {
  font-size: 14px;
  line-height: 1;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px 4px;
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0.6px;
}

.section-count {
  font-size: 10.5px;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.search-input {
  flex: 1;
  min-width: 0;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.search-input:focus {
  border-color: var(--accent);
}

.archive-toggle {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.archive-toggle.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.list-area {
  flex: 1;
  min-height: 0;
  padding: 6px;
  overflow: auto;
}

.section-label {
  padding: 5px 6px 3px;
  font-size: 10.5px;
  letter-spacing: 0.6px;
  color: var(--text-muted);
}

.project-group {
  margin-top: 4px;
}

.project-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 4px 4px 2px;
  color: var(--text-muted);
}

.project-header.clickable {
  cursor: pointer;
}

.project-header.clickable:hover {
  color: var(--text);
}

.folder-icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--text-muted);
}

.project-header.clickable:hover .folder-icon {
  color: var(--accent);
}

.project-name {
  flex: 1;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg);
  font-size: 10px;
}

.project-rename-input {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.session-list {
  margin: 0;
  padding: 0 0 2px 18px;
  list-style: none;
}

.group-empty {
  padding: 4px 9px 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.empty {
  padding: 14px 10px;
  font-size: 12px;
  color: var(--text-muted);
}

@media (max-width: 1200px) {
  .session-panel {
    width: 270px;
  }
}

@media (max-width: 1024px) {
  .session-panel {
    width: 250px;
  }
}
</style>
