<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProjectSummary, SessionSummary } from '@shared/session'
import type { ContextMenuItem } from '../lib/menu'
import { useChatStore } from '../stores/chat'
import { useProjectsStore } from '../stores/projects'
import { useSessionStore } from '../stores/session'
import { useWorkspaceStore } from '../stores/workspace'
import ContextMenu from './ContextMenu.vue'
import MoveSessionDialog from './MoveSessionDialog.vue'
import SessionListItem from './SessionListItem.vue'

const sessions = useSessionStore()
const projects = useProjectsStore()
const workspace = useWorkspaceStore()
const chat = useChatStore()

const query = ref('')
const showArchived = ref(false)
const moveTarget = ref<SessionSummary | null>(null)
const editingProjectId = ref<string | null>(null)
const editingProjectName = ref('')
const projectMenu = ref<{ x: number; y: number; project: ProjectSummary } | null>(null)

const projectMenuItems: ContextMenuItem[] = [
  { id: 'new-session', label: '在项目中新建会话', testid: 'project-new-session' },
  { id: 'rename', label: '重命名项目', testid: 'project-rename', separatorBefore: true }
]

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
    list.push({ id: 'unassigned', name: '未归属会话', project: null, sessions: unassigned })
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
  if (group.project) projects.toggleExpanded(group.project.id)
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

function selectProjectMenu(id: string): void {
  const project = projectMenu.value?.project
  projectMenu.value = null
  if (!project) return
  if (id === 'new-session') {
    void createSession(project.id)
  } else if (id === 'rename') {
    startProjectRename(project)
  }
}
</script>

<template>
  <aside class="session-panel" data-testid="session-sidebar">
    <div class="brand">
      <img class="brand-logo" src="/image/yocim.png" alt="YOCIM" />
      <span class="brand-name" data-testid="app-title">YOCIM AGRNT</span>
    </div>

    <button
      type="button"
      class="new-session"
      data-testid="new-session"
      title="新建会话 (Ctrl+N)"
      @click="createSessionFromHeader"
    >
      <span class="plus">＋</span>
      新会话
    </button>

    <div class="search-row">
      <input
        v-model="query"
        class="search-input"
        type="search"
        placeholder="搜索会话 (Ctrl+K)"
        data-testid="session-search"
      />
      <button
        type="button"
        class="archive-toggle"
        :class="{ active: showArchived }"
        data-testid="archive-toggle"
        :title="showArchived ? '隐藏已归档' : '显示已归档'"
        @click="showArchived = !showArchived"
      >
        ▣
      </button>
    </div>

    <div class="section-head">
      <span>工作区</span>
      <span class="section-count">{{ projects.projects.length }}</span>
    </div>

    <div class="list-area">
      <section v-if="pinnedSessions.length" class="pinned" data-testid="pinned-section">
        <div class="section-label">★ 置顶</div>
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
          data-testid="project-header"
          @contextmenu.prevent.stop="group.project && openProjectMenu($event, group.project)"
        >
          <button
            type="button"
            class="chevron"
            :disabled="!group.project"
            :title="isExpanded(group) ? '折叠项目' : '展开项目'"
            @click="toggleGroup(group)"
          >
            {{ isExpanded(group) ? '▾' : '▸' }}
          </button>
          <input
            v-if="editingProjectId === group.id"
            v-model="editingProjectName"
            class="project-rename-input"
            data-testid="project-rename-input"
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
          <li v-if="!group.sessions.length" class="group-empty">暂无会话</li>
        </ul>
      </section>

      <p v-if="!sessions.sessions.length && !projects.projects.length" class="empty">
        选择工作区后，可在这里创建会话。
      </p>
      <p v-else-if="!visibleSessions.length" class="empty">
        {{ query ? '没有匹配的会话。' : '暂无会话，点击“新建”开始。' }}
      </p>
    </div>

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
  </aside>
</template>

<style scoped>
.session-panel {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 300px;
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
  cursor: default;
}

.chevron {
  width: 18px;
  height: 18px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}

.chevron:disabled {
  cursor: default;
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
