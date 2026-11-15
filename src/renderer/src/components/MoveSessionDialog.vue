<script setup lang="ts">
import type { ProjectSummary, SessionSummary } from '@shared/session'
import { useSessionStore } from '../stores/session'

const props = defineProps<{
  session: SessionSummary
  projects: ProjectSummary[]
}>()

const emit = defineEmits<{
  close: []
  moved: []
}>()

const sessions = useSessionStore()

async function moveTo(projectId: string): Promise<void> {
  const ok = await sessions.moveSession(props.session.id, projectId)
  if (ok) {
    emit('moved')
    emit('close')
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" data-testid="move-dialog">
      <h2>移动会话</h2>
      <p class="subtitle">将「{{ session.title }}」移动到其他项目：</p>
      <div class="project-list">
        <button
          v-for="project in projects.filter((item) => item.id !== session.projectId)"
          :key="project.id"
          type="button"
          class="project-option"
          data-testid="move-project-option"
          @click="moveTo(project.id)"
        >
          <span class="project-name">{{ project.name }}</span>
          <span class="project-path">{{ project.root }}</span>
        </button>
        <p
          v-if="projects.filter((item) => item.id !== session.projectId).length === 0"
          class="empty"
        >
          暂无可迁移的其他项目。请先在顶部切换/添加工作区。
        </p>
      </div>
      <div class="actions">
        <button type="button" @click="emit('close')">取消</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(16, 24, 40, 0.28);
}

.dialog {
  width: 440px;
  max-height: 70vh;
  padding: 22px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  overflow: auto;
}

.dialog h2 {
  margin: 0 0 6px;
  font-size: 17px;
}

.subtitle {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--text-muted);
}

.project-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.project-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.project-option:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.project-name {
  font-size: 13px;
  font-weight: 600;
}

.project-path {
  overflow: hidden;
  font-size: 11px;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
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
</style>
