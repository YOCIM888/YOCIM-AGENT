<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { languageForPath, monaco } from '../lib/monaco'
import { useChatStore } from '../stores/chat'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'

const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const chat = useChatStore()
const container = ref<HTMLDivElement | null>(null)
const diffContainer = ref<HTMLDivElement | null>(null)
const models = new Map<string, monaco.editor.ITextModel>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null
let diffModels: { original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null =
  null

const monacoTheme = computed(() => (settings.theme === 'dark' ? 'vs-dark' : 'vs'))
const fileMeta = computed(() => {
  const file = workspace.activeFile
  if (!file) return ''
  const size =
    file.size >= 1024 * 1024
      ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
      : `${(file.size / 1024).toFixed(1)} KB`
  return `${size}${file.truncated ? ' · 已截断' : ''}`
})

function applyActiveFile(): void {
  if (!editor) return
  const file = workspace.activeFile
  if (!file) return

  let model = models.get(file.relativePath)
  if (!model || model.isDisposed()) {
    const uri = monaco.Uri.parse(`inmemory://workspace/${encodeURI(file.relativePath)}`)
    model = monaco.editor.createModel(file.content, languageForPath(file.relativePath), uri)
    models.set(file.relativePath, model)
  } else if (model.getValue() !== file.content) {
    model.setValue(file.content)
  }
  editor.setModel(model)
}

function applyReveal(): void {
  const request = workspace.pendingReveal
  if (!request || !editor) return
  if (workspace.diff) workspace.closeDiff()
  editor.revealLineInCenter(request.line)
  editor.setPosition({ lineNumber: request.line, column: request.column })
  editor.focus()
  workspace.clearReveal()
}

function disposeDiff(): void {
  diffEditor?.dispose()
  diffEditor = null
  diffModels?.original.dispose()
  diffModels?.modified.dispose()
  diffModels = null
}

function attachToChat(): void {
  const file = workspace.activeFile
  if (!file) return
  void chat.attachFile({ relativePath: file.relativePath })
}

onMounted(() => {
  if (!container.value) return
  editor = monaco.editor.create(container.value, {
    value: '',
    language: 'plaintext',
    theme: monacoTheme.value,
    readOnly: true,
    automaticLayout: true,
    fontSize: settings.fontSize,
    wordWrap: settings.wordWrap,
    minimap: { enabled: settings.minimap },
    scrollBeyondLastLine: false,
    padding: { top: 8 }
  })
  editor.onDidChangeCursorPosition((event) => workspace.setCursorLine(event.position.lineNumber))
  applyActiveFile()
  applyReveal()
})

watch(() => workspace.activeFile, applyActiveFile)
watch(() => workspace.pendingReveal, applyReveal)
watch(
  () => settings.fontSize,
  (value) => editor?.updateOptions({ fontSize: value })
)
watch(
  () => settings.wordWrap,
  (value) => editor?.updateOptions({ wordWrap: value })
)
watch(
  () => settings.minimap,
  (value) => editor?.updateOptions({ minimap: { enabled: value } })
)
watch(monacoTheme, (value) => monaco.editor.setTheme(value))

watch(
  () => workspace.diff,
  async (value) => {
    disposeDiff()
    if (!value) return
    await nextTick()
    if (!diffContainer.value) return
    diffEditor = monaco.editor.createDiffEditor(diffContainer.value, {
      readOnly: true,
      automaticLayout: true,
      theme: monacoTheme.value,
      fontSize: settings.fontSize,
      renderSideBySide: true,
      scrollBeyondLastLine: false
    })
    const original = monaco.editor.createModel(value.original, value.language)
    const modified = monaco.editor.createModel(value.modified, value.language)
    diffModels = { original, modified }
    diffEditor.setModel({ original, modified })
  },
  { immediate: true }
)

watch(
  () => workspace.info?.root,
  () => {
    editor?.setModel(null)
    models.forEach((model) => model.dispose())
    models.clear()
    disposeDiff()
    applyActiveFile()
  }
)

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
  models.forEach((model) => model.dispose())
  models.clear()
  disposeDiff()
})
</script>

<template>
  <section class="editor" data-testid="editor-pane">
    <div class="panel-header">
      <span class="file-name">
        {{ workspace.activeFile ? workspace.activeFile.relativePath : '编辑器' }}
      </span>
      <div class="file-actions">
        <span v-if="workspace.activeFile" class="file-meta">{{ fileMeta }}</span>
        <button
          v-if="workspace.activeFile"
          type="button"
          class="attach-context"
          title="添加当前文件到对话"
          data-testid="editor-attach"
          @click="attachToChat"
        >
          添加到对话
        </button>
        <span v-if="workspace.activeFile" class="badge">只读</span>
      </div>
    </div>
    <div ref="container" class="monaco-container"></div>
    <div v-if="workspace.diff" class="diff-overlay" data-testid="diff-overlay">
      <div class="diff-header">
        <span class="diff-title">{{ workspace.diff.title }}</span>
        <button
          type="button"
          class="diff-close"
          data-testid="diff-close"
          @click="workspace.closeDiff()"
        >
          关闭 Diff
        </button>
      </div>
      <div ref="diffContainer" class="diff-container"></div>
    </div>
    <div v-if="!workspace.activeFile" class="editor-empty">
      <h2>未打开文件</h2>
      <p>从右侧文件树选择一个文件，使用 Monaco 查看。</p>
      <button
        type="button"
        class="open-tree"
        data-testid="editor-open-tree"
        @click="settings.setWorkspaceView('files')"
      >
        打开文件树
      </button>
    </div>
  </section>
</template>

<style scoped>
.editor {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.file-name {
  overflow: hidden;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.file-meta {
  font-size: 10.5px;
  color: var(--text-muted);
}

.attach-context {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.attach-context:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.badge {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 11px;
  color: var(--muted);
}

.monaco-container {
  flex: 1;
  min-height: 0;
}

.diff-overlay {
  position: absolute;
  inset: 34px 0 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.diff-title {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-close {
  flex: none;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.diff-close:hover {
  background: var(--bg-hover);
}

.diff-container {
  flex: 1;
  min-height: 0;
}

.editor-empty {
  position: absolute;
  inset: 34px 0 0;
  display: grid;
  place-content: center;
  gap: 6px;
  background: var(--bg);
  text-align: center;
}

.editor-empty h2 {
  margin: 0;
  font-size: 17px;
}

.editor-empty p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.open-tree {
  margin-top: 10px;
  justify-self: center;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.open-tree:hover {
  background: var(--bg-hover);
}
</style>
