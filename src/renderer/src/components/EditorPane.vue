<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { languageForPath, monaco } from '../lib/monaco'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'

const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const container = ref<HTMLDivElement | null>(null)
const models = new Map<string, monaco.editor.ITextModel>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null

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
  applyActiveFile()
})

watch(() => workspace.activeFile, applyActiveFile)
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
  () => workspace.info?.root,
  () => {
    editor?.setModel(null)
    models.forEach((model) => model.dispose())
    models.clear()
    applyActiveFile()
  }
)

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
  models.forEach((model) => model.dispose())
  models.clear()
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
        <span v-if="workspace.activeFile" class="badge">只读</span>
      </div>
    </div>
    <div ref="container" class="monaco-container"></div>
    <div v-if="!workspace.activeFile" class="editor-empty">
      <h2>未打开文件</h2>
      <p>从右侧文件树选择一个文件，使用 Monaco 查看。</p>
      <button
        type="button"
        class="open-tree"
        data-testid="editor-open-tree"
        @click="settings.setWorkspaceTab('files')"
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
