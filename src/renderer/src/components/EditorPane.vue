<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { registerExtensionSnippets } from '../lib/extensionSnippets'
import { languageForPath, monaco } from '../lib/monaco'
import { useChatStore } from '../stores/chat'
import { useDebugStore } from '../stores/debug'
import { useExtensionsStore } from '../stores/extensions'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore, type EditorTab } from '../stores/workspace'
import ConfirmDialog from './ConfirmDialog.vue'
import SaveConflictDialog from './SaveConflictDialog.vue'

const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const chat = useChatStore()
const debug = useDebugStore()
const extensions = useExtensionsStore()
const container = ref<HTMLDivElement | null>(null)
const diffContainer = ref<HTMLDivElement | null>(null)
const models = new Map<string, monaco.editor.ITextModel>()
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let breakpointDecorations: monaco.editor.IEditorDecorationsCollection | null = null
let pausedDecorations: monaco.editor.IEditorDecorationsCollection | null = null
let snippetRegistration: { dispose: () => void } | null = null
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null
let diffModels: { original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null =
  null
let currentModelPath: string | null = null
let savingLocal = false

const manualReadOnly = ref(false)
const pendingCloseId = ref<string | null>(null)
const pendingCloseAll = ref(false)

const monacoTheme = computed(() => (settings.theme === 'dark' ? 'vs-dark' : 'vs'))
const activeTab = computed(() => workspace.activeTab)
const isSpecial = computed(() => Boolean(activeTab.value && activeTab.value.kind !== 'text'))
const readOnly = computed(
  () => manualReadOnly.value || Boolean(activeTab.value?.readOnly) || isSpecial.value
)
const imageSrc = computed(() => activeTab.value?.imageDataUrl ?? '')
const binaryHint = computed(
  () => activeTab.value?.loadError ?? '二进制文件不可编辑，请在外部程序中打开'
)
const conflict = computed(() => (activeTab.value?.disk ? activeTab.value.relativePath : null))
const statusLabel = computed(() => {
  const tab = activeTab.value
  if (!tab) return '未打开文件'
  if (tab.kind !== 'text') return '只读预览'
  if (tab.content !== tab.savedContent) return '未保存'
  return readOnly.value ? '只读' : '可编辑'
})

function formatSize(size: number): string {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${(size / 1024).toFixed(1)} KB`
}

function baseName(relativePath: string): string {
  return relativePath.split('/').pop() ?? relativePath
}

function modelFor(tab: EditorTab): monaco.editor.ITextModel {
  let model = models.get(tab.relativePath)
  if (!model || model.isDisposed()) {
    const uri = monaco.Uri.parse(`inmemory://workspace/${encodeURI(tab.relativePath)}`)
    model = monaco.editor.createModel(tab.content, languageForPath(tab.relativePath), uri)
    models.set(tab.relativePath, model)
  }
  return model
}

function pruneModels(): void {
  const alive = new Set(workspace.tabs.map((tab) => tab.relativePath))
  for (const [key, model] of models) {
    if (alive.has(key)) continue
    model.dispose()
    models.delete(key)
    viewStates.delete(key)
  }
}

function applyReveal(): void {
  const request = workspace.pendingReveal
  if (!request || !editor || !activeTab.value || activeTab.value.kind !== 'text') return
  if (workspace.diff) workspace.closeDiff()
  editor.revealLineInCenter(request.line)
  editor.setSelection({
    startLineNumber: request.line,
    startColumn: request.column,
    endLineNumber: request.line,
    endColumn: request.endColumn ?? request.column
  })
  // 面板被其他视图占用时编辑器不可见，聚焦会抢走调试面板的输入焦点
  if (editor.getDomNode()?.offsetParent) editor.focus()
  workspace.clearReveal()
}

function applyDecorations(): void {
  if (!editor) return
  const path = currentModelPath
  if (!path) {
    breakpointDecorations?.clear()
    pausedDecorations?.clear()
    return
  }

  const breakpointRanges = debug.breakpoints
    .filter((bp) => bp.relativePath === path)
    .map((bp) => ({
      range: new monaco.Range(bp.line, 1, bp.line, 1),
      options: {
        glyphMarginClassName: bp.verified
          ? 'yocim-bp-glyph yocim-bp-glyph-verified'
          : 'yocim-bp-glyph',
        glyphMarginHoverMessage: {
          value: bp.condition ? `断点（条件：${bp.condition}）` : '断点'
        },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    }))
  breakpointDecorations?.set(breakpointRanges)

  const location = debug.pauseLocation
  if (location && location.relativePath === path) {
    pausedDecorations?.set([
      {
        range: new monaco.Range(location.line, 1, location.line, 1),
        options: {
          isWholeLine: true,
          className: 'yocim-debug-current-line',
          glyphMarginClassName: 'yocim-debug-paused-glyph',
          glyphMarginHoverMessage: { value: '当前执行行' }
        }
      }
    ])
  } else {
    pausedDecorations?.clear()
  }
}

function onGlyphClick(event: monaco.editor.IEditorMouseEvent): void {
  if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
  const line = event.target.position?.lineNumber
  const path = currentModelPath
  if (!line || !path) return
  void debug.toggleBreakpoint(path, line)
}

function applyActiveTab(): void {
  if (!editor) return
  if (currentModelPath) viewStates.set(currentModelPath, editor.saveViewState())
  const tab = workspace.activeTab
  if (!tab || tab.kind !== 'text') {
    editor.setModel(null)
    currentModelPath = null
    return
  }
  const model = modelFor(tab)
  if (model.getValue() !== tab.content) model.setValue(tab.content)
  if (editor.getModel() !== model) {
    editor.setModel(model)
    const state = viewStates.get(tab.relativePath)
    if (state) editor.restoreViewState(state)
  }
  currentModelPath = tab.relativePath
  editor.updateOptions({ readOnly: readOnly.value })
  applyReveal()
}

function disposeDiff(): void {
  diffEditor?.dispose()
  diffEditor = null
  diffModels?.original.dispose()
  diffModels?.modified.dispose()
  diffModels = null
}

async function save(): Promise<void> {
  const tab = workspace.activeTab
  if (!tab || tab.kind !== 'text' || tab.readOnly || manualReadOnly.value || savingLocal) return
  savingLocal = true
  try {
    await workspace.saveActiveFile()
  } finally {
    savingLocal = false
  }
}

async function overwrite(): Promise<void> {
  await workspace.saveActiveFile({ force: true })
  workspace.clearConflict()
}

async function reloadDisk(): Promise<void> {
  await workspace.resolveConflictWithDisk()
}

async function saveAs(path: string): Promise<void> {
  await workspace.saveActiveFile({ targetPath: path })
  workspace.clearConflict()
}

function attachToChat(): void {
  const tab = workspace.activeTab
  if (!tab) return
  const selection = editor?.getSelection()
  const model = editor?.getModel()
  if (
    tab.kind === 'text' &&
    selection &&
    model &&
    !selection.isEmpty() &&
    model.getValueLengthInRange(selection) > 0
  ) {
    chat.attachSelection({
      relativePath: tab.relativePath,
      content: model.getValueInRange(selection),
      range: {
        startLine: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLine: selection.endLineNumber,
        endColumn: selection.endColumn
      }
    })
  } else {
    void chat.attachFile({ relativePath: tab.relativePath })
  }
}

function requestClose(id: string): void {
  const tab = workspace.tabs.find((item) => item.id === id)
  if (tab && tab.kind === 'text' && tab.content !== tab.savedContent) {
    pendingCloseId.value = id
    return
  }
  workspace.closeTab(id)
}

function confirmDiscard(): void {
  const id = pendingCloseId.value
  pendingCloseId.value = null
  if (id) workspace.closeTab(id)
}

function requestCloseAll(): void {
  const dirty = workspace.tabs.some(
    (tab) => tab.kind === 'text' && tab.content !== tab.savedContent
  )
  if (dirty) {
    pendingCloseAll.value = true
    return
  }
  workspace.closeAllTabs()
}

function confirmCloseAll(): void {
  pendingCloseAll.value = false
  workspace.closeAllTabs()
}

function closeDiscardDialog(): void {
  pendingCloseId.value = null
  pendingCloseAll.value = false
}

function toggleReadOnly(): void {
  manualReadOnly.value = !manualReadOnly.value
  editor?.updateOptions({ readOnly: readOnly.value })
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  if (!container.value) return
  editor = monaco.editor.create(container.value, {
    value: '',
    language: 'plaintext',
    theme: monacoTheme.value,
    readOnly: readOnly.value,
    automaticLayout: true,
    fontSize: settings.fontSize,
    wordWrap: settings.wordWrap,
    minimap: { enabled: settings.minimap },
    scrollBeyondLastLine: false,
    glyphMargin: true,
    padding: { top: 8 }
  })
  breakpointDecorations = editor.createDecorationsCollection()
  pausedDecorations = editor.createDecorationsCollection()
  editor.onMouseDown(onGlyphClick)
  editor.onDidChangeCursorPosition((event) => workspace.setCursorLine(event.position.lineNumber))
  editor.onDidChangeModelContent(() => {
    const tab = workspace.activeTab
    const model = editor?.getModel()
    if (!tab || !model || tab.kind !== 'text' || currentModelPath !== tab.relativePath) return
    workspace.updateContent(tab.id, model.getValue())
  })
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    void save()
  })
  editor.addAction({
    id: 'yocim.addToChat',
    label: '添加到对话',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1,
    run: () => attachToChat()
  })
  applyActiveTab()
  applyDecorations()
  snippetRegistration = registerExtensionSnippets(() => extensions.contributions.snippets)
  if (!extensions.contributions.version) void extensions.refreshContributions()
})

watch(() => workspace.activeTabId, applyActiveTab)
watch(() => workspace.activeTabId, applyDecorations)
watch(
  () =>
    debug.breakpoints
      .map((bp) => `${bp.id}:${bp.relativePath}:${bp.line}:${bp.verified ?? ''}`)
      .join('|'),
  applyDecorations
)
watch(
  () => debug.pauseLocation,
  async (location) => {
    if (!location) {
      applyDecorations()
      return
    }
    if (workspace.activeTab?.relativePath !== location.relativePath) {
      await workspace.openPath(location.relativePath, { pin: false })
    }
    // 断点暂停时不抢占当前视图：只在编辑器内滚动到当前行
    workspace.requestReveal(location.line, 1, undefined, { keepView: true })
    applyDecorations()
  }
)
watch(
  () => workspace.activeTab?.content,
  () => {
    const tab = workspace.activeTab
    const model = editor?.getModel()
    if (!tab || !model || tab.kind !== 'text' || currentModelPath !== tab.relativePath) return
    if (model.getValue() !== tab.content) model.setValue(tab.content)
  }
)
watch(
  () => workspace.tabs.map((tab) => tab.relativePath).join('\u0000'),
  () => {
    editor?.setModel(null)
    currentModelPath = null
    pruneModels()
    applyActiveTab()
  }
)
watch(() => workspace.pendingReveal, applyReveal)
watch(readOnly, (value) => editor?.updateOptions({ readOnly: value }))
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
    currentModelPath = null
    models.forEach((model) => model.dispose())
    models.clear()
    viewStates.clear()
    disposeDiff()
    applyActiveTab()
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  snippetRegistration?.dispose()
  snippetRegistration = null
  editor?.dispose()
  editor = null
  models.forEach((model) => model.dispose())
  models.clear()
  viewStates.clear()
  disposeDiff()
})
</script>

<template>
  <section class="editor" data-testid="editor-pane">
    <div class="tabs-bar" data-testid="editor-tabs">
      <button
        v-for="tab in workspace.tabs"
        :key="tab.id"
        type="button"
        class="tab"
        :class="{ active: tab.id === workspace.activeTabId, preview: tab.isPreview }"
        :title="tab.relativePath"
        :data-testid="`editor-tab-${tab.relativePath}`"
        @click="workspace.activateTab(tab.id)"
        @dblclick="workspace.pinActiveFile()"
      >
        <span class="tab-name">{{ baseName(tab.relativePath) }}</span>
        <span
          v-if="tab.kind === 'text' && tab.content !== tab.savedContent"
          class="dirty"
          data-testid="editor-dirty"
          title="未保存"
        >
          ●
        </span>
        <span
          class="tab-close"
          :data-testid="`editor-tab-close-${tab.relativePath}`"
          title="关闭"
          @click.stop="requestClose(tab.id)"
        >
          ×
        </span>
      </button>
      <button
        v-if="workspace.tabs.length"
        type="button"
        class="close-all"
        title="全部关闭"
        data-testid="editor-close-all"
        @click="requestCloseAll"
      >
        ⊞
      </button>
    </div>

    <div class="panel-header">
      <div class="file-info">
        <span class="file-name" :title="activeTab?.relativePath">
          {{ activeTab ? activeTab.relativePath : '编辑器' }}
        </span>
        <span v-if="activeTab" class="file-meta" data-testid="editor-size">
          {{ formatSize(activeTab.size) }}{{ activeTab.truncated ? ' · 已截断' : '' }}
        </span>
        <span class="badge" data-testid="editor-status">{{ statusLabel }}</span>
      </div>
      <div class="file-actions">
        <button
          v-if="activeTab"
          type="button"
          class="header-action"
          data-testid="editor-readonly-toggle"
          @click="toggleReadOnly"
        >
          {{ manualReadOnly ? '可编辑' : '只读' }}
        </button>
        <button
          v-if="activeTab && activeTab.kind === 'text' && !readOnly"
          type="button"
          class="header-action primary"
          data-testid="editor-save"
          title="保存 (Ctrl+S)"
          @click="save"
        >
          保存
        </button>
        <button
          v-if="activeTab"
          type="button"
          class="header-action"
          title="添加当前文件或选区到对话"
          data-testid="editor-attach"
          @click="attachToChat"
        >
          添加到对话
        </button>
      </div>
    </div>

    <div class="editor-body">
      <div v-show="!isSpecial" ref="container" class="monaco-container"></div>

      <div v-if="activeTab?.kind === 'image'" class="image-preview" data-testid="editor-image">
        <img v-if="imageSrc" :src="imageSrc" :alt="activeTab.relativePath" />
        <p v-else>图片过大，无法预览</p>
      </div>
      <div v-else-if="activeTab?.kind === 'binary'" class="binary-hint" data-testid="editor-binary">
        {{ binaryHint }}
      </div>

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

      <div v-if="!activeTab && !workspace.diff" class="editor-empty">
        <h2>未打开文件</h2>
        <p>从右侧文件树选择一个文件，使用 Monaco 查看与编辑。</p>
        <button
          type="button"
          class="open-tree"
          data-testid="editor-open-tree"
          @click="settings.setWorkspaceView('files')"
        >
          打开文件树
        </button>
      </div>
    </div>

    <p v-if="workspace.error" class="editor-error" data-testid="editor-error">
      {{ workspace.error }}
    </p>

    <SaveConflictDialog
      v-if="conflict"
      :relative-path="conflict"
      @overwrite="overwrite"
      @reload="reloadDisk"
      @save-as="saveAs"
      @close="workspace.clearConflict()"
    />
    <ConfirmDialog
      v-if="pendingCloseId || pendingCloseAll"
      title="放弃未保存的更改"
      message="编辑器中有未保存的内容，关闭标签将丢弃这些修改。确定继续吗？"
      confirm-label="放弃并关闭"
      testid="discard-dialog"
      danger
      @confirm="pendingCloseAll ? confirmCloseAll() : confirmDiscard()"
      @close="closeDiscardDialog"
    />
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

.tabs-bar {
  display: flex;
  flex: none;
  align-items: stretch;
  min-height: 28px;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
  scrollbar-width: none;
}

.tabs-bar::-webkit-scrollbar {
  display: none;
}

.tab {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  padding: 0 6px 0 10px;
  border: 0;
  border-right: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.tab.active {
  background: var(--bg);
  color: var(--text);
  box-shadow: inset 0 2px 0 var(--accent);
}

.tab:hover {
  background: var(--bg-hover);
}

.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab.preview .tab-name {
  font-style: italic;
}

.dirty {
  flex: none;
  color: var(--warning);
  font-size: 9px;
}

.tab-close {
  flex: none;
  padding: 0 2px;
  border-radius: 3px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
}

.tab-close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.close-all {
  flex: none;
  margin-left: auto;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.close-all:hover {
  color: var(--text);
}

.panel-header {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 4px 10px 5px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

/* 窄面板下把路径信息与操作按钮拆成两行，避免按钮被右侧窗口边缘裁切 */
.file-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
}

.file-meta {
  flex: none;
  font-size: 10.5px;
  color: var(--text-muted);
  white-space: nowrap;
}

.badge {
  flex: none;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
}

.editor-body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.header-action {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.header-action:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.header-action.primary {
  border-color: var(--accent);
  color: var(--accent);
}

.monaco-container,
.image-preview,
.binary-hint {
  flex: 1;
  min-height: 0;
}

.image-preview {
  display: grid;
  place-items: center;
  overflow: auto;
  padding: 12px;
  background: var(--bg-subtle);
}

.image-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.image-preview p,
.binary-hint {
  margin: 0;
  padding: 20px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.diff-overlay {
  position: absolute;
  inset: 0;
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
  inset: 0;
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

.editor-error {
  position: absolute;
  right: 8px;
  bottom: 8px;
  left: 8px;
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11px;
}
</style>

<style>
/* Monaco 装饰类作用在编辑器内部 DOM，不能用 scoped */
.yocim-bp-glyph::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 8px;
  border: 1px solid var(--danger);
  border-radius: 50%;
  background: transparent;
  transform: translate(-50%, -50%);
}

.yocim-bp-glyph-verified::after {
  background: var(--danger);
}

.yocim-debug-paused-glyph::after {
  content: '▶';
  position: absolute;
  top: 50%;
  left: 50%;
  color: var(--accent);
  font-size: 9px;
  line-height: 1;
  transform: translate(-50%, -50%);
}

.yocim-debug-current-line {
  background: rgba(234, 179, 8, 0.16);
}
</style>
