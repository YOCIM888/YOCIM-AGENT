<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ConventionRecord } from '@shared/ipc'
import { useProjectsStore } from '../stores/projects'
import { useSessionStore } from '../stores/session'
import { useWorkspaceStore } from '../stores/workspace'
import ConfirmDialog from './ConfirmDialog.vue'
import MarkdownMessage from './MarkdownMessage.vue'

const emit = defineEmits<{ close: [] }>()
const sessions = useSessionStore()
const projects = useProjectsStore()
const workspace = useWorkspaceStore()

const projectId = computed(
  () =>
    sessions.activeSession?.projectId ??
    projects.projects.find((project) => project.root === workspace.info?.root)?.id ??
    null
)
const projectName = computed(
  () => projects.projects.find((project) => project.id === projectId.value)?.name ?? '当前项目'
)

const record = ref<ConventionRecord | null>(null)
const draft = ref('')
const mode = ref<'preview' | 'edit'>('preview')
const loading = ref(false)
const saving = ref(false)
const generating = ref(false)
const deleting = ref(false)
const loadError = ref('')
const notice = ref<{ kind: 'success' | 'error'; text: string } | null>(null)
const generatedDraft = ref(false)
const confirmKind = ref<'overwrite' | 'delete' | null>(null)
const editor = ref<HTMLTextAreaElement | null>(null)

let sequence = 0
let noticeTimer: ReturnType<typeof setTimeout> | null = null

function showNotice(kind: 'success' | 'error', text: string): void {
  notice.value = { kind, text }
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = null
  }, 4000)
}

function stale(id: string, seq: number): boolean {
  return id !== projectId.value || seq !== sequence
}

async function load(): Promise<void> {
  const id = projectId.value
  const seq = ++sequence
  record.value = null
  draft.value = ''
  mode.value = 'preview'
  generatedDraft.value = false
  loadError.value = ''
  notice.value = null
  if (!id) return

  loading.value = true
  try {
    const result = await window.yocim.conventions.get({ projectId: id })
    if (stale(id, seq)) return
    if (!result.ok) {
      loadError.value = result.error.message
    } else {
      record.value = result.data
      draft.value = result.data?.content ?? ''
    }
  } catch (error) {
    if (!stale(id, seq)) loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (!stale(id, seq)) loading.value = false
  }
}

watch(projectId, () => void load(), { immediate: true })

async function startEdit(): Promise<void> {
  draft.value = record.value?.content ?? ''
  generatedDraft.value = false
  mode.value = 'edit'
  await nextTick()
  editor.value?.focus()
}

function cancelEdit(): void {
  draft.value = record.value?.content ?? ''
  generatedDraft.value = false
  mode.value = 'preview'
}

async function save(): Promise<void> {
  const id = projectId.value
  const content = draft.value.trim()
  if (!id || saving.value || !content) return
  const seq = sequence
  saving.value = true
  try {
    const result = await window.yocim.conventions.save({
      projectId: id,
      content,
      source: generatedDraft.value ? 'ai' : 'manual'
    })
    if (stale(id, seq)) return
    if (!result.ok) {
      showNotice('error', `保存失败：${result.error.message}`)
      return
    }
    record.value = result.data
    draft.value = result.data.content
    generatedDraft.value = false
    mode.value = 'preview'
    showNotice('success', '项目约定已保存')
  } catch (error) {
    showNotice('error', `保存失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    saving.value = false
  }
}

async function runGenerate(): Promise<void> {
  const id = projectId.value
  if (!id || generating.value) return
  const seq = sequence
  confirmKind.value = null
  generating.value = true
  loadError.value = ''
  try {
    const result = await window.yocim.conventions.generate({ projectId: id })
    if (stale(id, seq)) return
    if (!result.ok) {
      showNotice('error', `生成失败：${result.error.message}`)
      return
    }
    draft.value = result.data.content
    generatedDraft.value = true
    mode.value = 'edit'
    showNotice('success', '已生成草稿，请确认后保存')
    await nextTick()
    editor.value?.focus()
  } catch (error) {
    showNotice('error', `生成失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    generating.value = false
  }
}

function requestGenerate(): void {
  if (!projectId.value || generating.value) return
  if (record.value?.content?.trim()) {
    confirmKind.value = 'overwrite'
    return
  }
  void runGenerate()
}

async function remove(): Promise<void> {
  const id = projectId.value
  if (!id || deleting.value) return
  const seq = sequence
  confirmKind.value = null
  deleting.value = true
  try {
    const result = await window.yocim.conventions.remove({ projectId: id })
    if (stale(id, seq)) return
    if (!result.ok) {
      showNotice('error', `删除失败：${result.error.message}`)
      return
    }
    record.value = null
    draft.value = ''
    mode.value = 'preview'
    showNotice('success', '项目约定已删除')
  } catch (error) {
    showNotice('error', `删除失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    deleting.value = false
  }
}

async function copy(): Promise<void> {
  const id = projectId.value
  if (!id || !record.value?.content) return
  try {
    const result = await window.yocim.conventions.copy({ projectId: id })
    showNotice(
      result.ok ? 'success' : 'error',
      result.ok ? '已复制项目约定' : `复制失败：${result.error.message}`
    )
  } catch (error) {
    showNotice('error', `复制失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function updatedLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

onBeforeUnmount(() => {
  sequence += 1
  if (noticeTimer) clearTimeout(noticeTimer)
})
</script>

<template>
  <Teleport to="body">
    <div class="overlay" data-testid="conventions-panel" @click.self="emit('close')">
      <section class="dialog" role="dialog" aria-label="项目约定">
        <header class="dialog-head">
          <div class="head-title">
            <h2>项目约定</h2>
            <span class="project-chip" data-testid="conventions-project">{{ projectName }}</span>
          </div>
          <button
            type="button"
            class="icon-button"
            data-testid="conventions-close"
            title="关闭"
            aria-label="关闭项目约定"
            @click="emit('close')"
          >
            ✕
          </button>
        </header>

        <div v-if="record" class="meta">
          <span class="source-chip">{{ record.source === 'ai' ? 'AI 生成' : '手动编辑' }}</span>
          <span>更新于 {{ updatedLabel(record.updatedAt) }}</span>
        </div>

        <p v-if="notice" class="notice" :class="notice.kind" data-testid="conventions-notice">
          {{ notice.text }}
        </p>

        <div class="dialog-body">
          <div v-if="!projectId" class="empty" data-testid="conventions-empty">
            <p>请先打开一个项目，再为它创建项目约定。</p>
          </div>
          <div v-else-if="loading" class="empty" data-testid="conventions-loading">
            正在加载项目约定…
          </div>
          <div v-else-if="loadError" class="empty error-state" data-testid="conventions-error">
            <p>加载失败：{{ loadError }}</p>
            <button type="button" data-testid="conventions-retry" @click="load()">重试</button>
          </div>
          <template v-else-if="mode === 'edit'">
            <p v-if="generatedDraft" class="draft-banner">AI 草稿待确认，保存后才会替换原内容。</p>
            <textarea
              ref="editor"
              v-model="draft"
              class="editor"
              data-testid="conventions-editor"
              spellcheck="false"
              placeholder="用 Markdown 写这个项目的约定…"
            ></textarea>
          </template>
          <MarkdownMessage
            v-else-if="record?.content"
            :content="record.content"
            data-testid="conventions-preview"
          />
          <div v-else class="empty" data-testid="conventions-empty">
            <p>这个项目还没有项目约定。</p>
            <p class="empty-hint">生成一份结构化说明，或直接手动编写，方便其他 AI 快速接手。</p>
            <div class="empty-actions">
              <button
                type="button"
                class="primary"
                data-testid="conventions-generate-empty"
                :disabled="generating"
                @click="requestGenerate()"
              >
                {{ generating ? '生成中…' : 'AI 生成' }}
              </button>
              <button type="button" data-testid="conventions-edit-empty" @click="startEdit()">
                手动编辑
              </button>
            </div>
          </div>
        </div>

        <footer class="dialog-foot">
          <template v-if="mode === 'edit'">
            <button type="button" data-testid="conventions-cancel" @click="cancelEdit()">
              取消编辑
            </button>
            <button
              type="button"
              class="primary"
              data-testid="conventions-save"
              :disabled="saving || !draft.trim() || !projectId"
              @click="save()"
            >
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              data-testid="conventions-edit"
              :disabled="!projectId || !!loadError || loading"
              @click="startEdit()"
            >
              编辑
            </button>
            <button
              type="button"
              class="primary"
              data-testid="conventions-generate"
              :disabled="!projectId || generating || !!loadError || loading"
              @click="requestGenerate()"
            >
              {{ generating ? '生成中…' : record?.content ? 'AI 更新约定' : 'AI 生成' }}
            </button>
            <button
              type="button"
              data-testid="conventions-copy"
              :disabled="!record?.content"
              @click="copy()"
            >
              复制
            </button>
            <button
              type="button"
              class="danger-button"
              data-testid="conventions-delete"
              :disabled="!record || deleting"
              @click="confirmKind = 'delete'"
            >
              {{ deleting ? '删除中…' : '删除' }}
            </button>
          </template>
        </footer>
      </section>

      <ConfirmDialog
        v-if="confirmKind === 'overwrite'"
        title="覆盖现有项目约定"
        message="AI 将基于当前项目上下文重新生成约定，保存后会覆盖现有内容。未保存的人工修改不会被保留。"
        confirm-label="继续生成"
        testid="conventions-overwrite-confirm"
        @close="confirmKind = null"
        @confirm="runGenerate()"
      />
      <ConfirmDialog
        v-if="confirmKind === 'delete'"
        title="删除项目约定"
        message="删除后当前项目的约定将进入空状态，且不可恢复；其他项目不受影响。"
        confirm-label="删除约定"
        danger
        testid="conventions-delete-confirm"
        @close="confirmKind = null"
        @confirm="remove()"
      />
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
  width: min(860px, calc(100vw - 64px));
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
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.head-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

h2 {
  margin: 0;
  font-size: 14px;
}

.project-chip {
  max-width: 240px;
  overflow: hidden;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.meta {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 8px 18px 0;
  color: var(--text-muted);
  font-size: 11px;
}

.source-chip {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}

.notice {
  flex: none;
  margin: 8px 18px 0;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: 11.5px;
}

.notice.success {
  background: var(--success-soft);
  color: var(--success);
}

.notice.error {
  background: var(--danger-soft);
  color: var(--danger);
}

.dialog-body {
  flex: 1;
  min-height: 0;
  padding: 14px 18px;
  overflow: auto;
}

.empty {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12.5px;
  text-align: center;
}

.empty p {
  margin: 0;
}

.empty-hint {
  font-size: 11.5px;
}

.empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.error-state {
  color: var(--danger);
}

.draft-banner {
  margin: 0 0 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11.5px;
}

.editor {
  width: 100%;
  height: 100%;
  min-height: 260px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  outline: none;
  resize: none;
}

.editor:focus {
  border-color: var(--accent);
}

.dialog-foot {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
}

.dialog-foot button,
.empty-actions button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dialog-foot button:hover:not(:disabled),
.empty-actions button:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--accent);
}

.dialog-foot button.primary,
.empty-actions button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--bg);
}

.dialog-foot button.danger-button {
  color: var(--danger);
}

.dialog-foot button:disabled,
.empty-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
