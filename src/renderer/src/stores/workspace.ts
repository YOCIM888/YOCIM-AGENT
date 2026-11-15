import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import type {
  FileEol,
  FsClipboardState,
  FsConflictResolution,
  FsFileVersion,
  FsReadFileResult,
  FsTransferResult,
  FsTreeNode,
  FsWriteFileResult,
  IpcResult,
  WorkspaceInfo
} from '@shared/ipc'

export interface OpenedFile {
  relativePath: string
  content: string
  truncated: boolean
  size: number
}

export type EditorTabKind = 'text' | 'image' | 'binary'

export interface EditorTab {
  id: string
  relativePath: string
  content: string
  savedContent: string
  contentHash: string
  eol: FileEol
  size: number
  truncated: boolean
  readOnly: boolean
  isPreview: boolean
  kind: EditorTabKind
  imageDataUrl?: string
  loadError?: string
  /** 保存时检测到外部修改，磁盘版本暂存于此供冲突对话框使用 */
  disk?: FsFileVersion | null
}

export interface EditorDiff {
  title: string
  relativePath: string
  language: string
  original: string
  modified: string
}

export interface RevealRequest {
  line: number
  column: number
  endColumn?: number
  /** 调试暂停等自动定位场景：滚动编辑器但不抢占当前工作区视图。 */
  keepView?: boolean
}

export const MAX_EDITOR_TABS = 12
const TABS_STORAGE_KEY = 'yocim.ui.editorTabs'

export function parentOf(relativePath: string): string {
  const index = relativePath.lastIndexOf('/')
  return index >= 0 ? relativePath.slice(0, index) : ''
}

let tabSequence = 0
function createTabId(): string {
  tabSequence += 1
  return `tab-${Date.now().toString(36)}-${tabSequence}`
}

function toTabData(result: FsReadFileResult): Omit<EditorTab, 'id' | 'isPreview'> {
  const content = result.content
  const kind = result.kind ?? 'text'
  return {
    relativePath: result.relativePath,
    content,
    savedContent: content,
    contentHash: result.contentHash ?? '',
    eol: result.eol ?? 'lf',
    size: result.size,
    truncated: result.truncated,
    readOnly: result.truncated || kind !== 'text',
    kind,
    imageDataUrl: result.imageDataUrl,
    loadError: undefined,
    disk: null
  }
}

function readStoredTabs(): { paths: string[]; activePath: string | null } {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY)
    if (!raw) return { paths: [], activePath: null }
    const parsed = JSON.parse(raw) as { paths?: unknown; activePath?: unknown }
    return {
      paths: Array.isArray(parsed.paths)
        ? parsed.paths
            .filter((item): item is string => typeof item === 'string')
            .slice(0, MAX_EDITOR_TABS)
        : [],
      activePath: typeof parsed.activePath === 'string' ? parsed.activePath : null
    }
  } catch {
    return { paths: [], activePath: null }
  }
}

function writeStoredTabs(tabs: EditorTab[], activePath: string | null): void {
  try {
    localStorage.setItem(
      TABS_STORAGE_KEY,
      JSON.stringify({ paths: tabs.map((tab) => tab.relativePath), activePath })
    )
  } catch {
    // 本地偏好写入失败不影响使用
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const info = ref<WorkspaceInfo | null>(null)
  const tree = ref<FsTreeNode[]>([])
  const childrenByDir = ref<Record<string, FsTreeNode[]>>({})
  const expanded = ref<Set<string>>(new Set())
  const loadingDirs = ref<Set<string>>(new Set())
  const clipboard = ref<FsClipboardState | null>(null)
  const selectedPath = ref<string | null>(null)
  const tabs = ref<EditorTab[]>([])
  const activeTabId = ref<string | null>(null)
  const error = ref('')
  const busy = ref(false)
  const restoring = ref(false)
  const cursorLine = ref(1)
  const pendingReveal = ref<RevealRequest | null>(null)
  const diff = ref<EditorDiff | null>(null)
  const saving = ref(false)
  /** 磁盘内容变化（保存 / 替换 / 恢复）后递增，驱动时间线重新拉取快照 */
  const timelineVersion = ref(0)

  const activeTab = computed<EditorTab | null>(
    () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null
  )
  /** P1 兼容：编辑器视图、大纲、时间线仍按「当前文件」读取。 */
  const activeFile = computed<OpenedFile | null>(() => {
    const tab = activeTab.value
    return tab
      ? {
          relativePath: tab.relativePath,
          content: tab.content,
          truncated: tab.truncated,
          size: tab.size
        }
      : null
  })
  const isPreview = computed(() => activeTab.value?.isPreview ?? false)
  const isDirty = computed(() => {
    const tab = activeTab.value
    return Boolean(tab && tab.kind === 'text' && tab.content !== tab.savedContent)
  })

  function setError(message: string): void {
    error.value = message
  }

  function clearError(): void {
    error.value = ''
  }

  function persistTabs(): void {
    writeStoredTabs(toRaw(tabs.value), activeTab.value?.relativePath ?? null)
  }

  function childrenOf(relativePath: string): FsTreeNode[] {
    return childrenByDir.value[relativePath] ?? []
  }

  async function loadChildren(relativePath: string, force = false): Promise<void> {
    if (!force && childrenByDir.value[relativePath]) return
    loadingDirs.value.add(relativePath)
    try {
      const result = await window.yocim.workspace.tree({ relativePath, depth: 1 })
      if (result.ok) {
        childrenByDir.value[relativePath] = result.data
      } else {
        delete childrenByDir.value[relativePath]
        expanded.value.delete(relativePath)
        if (result.error.code !== 'E_NOT_FOUND') setError(result.error.message)
      }
    } finally {
      loadingDirs.value.delete(relativePath)
    }
  }

  async function refreshTree(): Promise<void> {
    const result = await window.yocim.workspace.tree({ relativePath: '', depth: 1 })
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    tree.value = result.data
    await Promise.all([...expanded.value].map((dir) => loadChildren(dir, true)))
  }

  async function toggleDir(node: FsTreeNode): Promise<void> {
    if (node.type !== 'directory') return
    if (expanded.value.has(node.relativePath)) {
      expanded.value.delete(node.relativePath)
      return
    }
    expanded.value.add(node.relativePath)
    await loadChildren(node.relativePath)
  }

  function collapseAll(): void {
    expanded.value.clear()
  }

  async function refreshClipboard(): Promise<void> {
    const result = await window.yocim.workspace.clipboard({ action: 'get' })
    clipboard.value = result.ok ? result.data : null
  }

  async function setClipboard(mode: 'cut' | 'copy', relativePath: string): Promise<void> {
    const result = await window.yocim.workspace.clipboard({ action: 'set', mode, relativePath })
    if (result.ok) {
      clipboard.value = result.data
    } else {
      setError(result.error.message)
    }
  }

  async function clearClipboard(): Promise<void> {
    await window.yocim.workspace.clipboard({ action: 'clear' })
    clipboard.value = null
  }

  async function resetWorkspace(): Promise<void> {
    tabs.value = []
    activeTabId.value = null
    selectedPath.value = null
    tree.value = []
    childrenByDir.value = {}
    expanded.value.clear()
    loadingDirs.value.clear()
    clipboard.value = null
    cursorLine.value = 1
    pendingReveal.value = null
    diff.value = null
    await refreshTree()
  }

  async function restoreTabs(): Promise<void> {
    const stored = readStoredTabs()
    for (const relativePath of stored.paths) {
      await openPath(relativePath, { pin: true })
    }
    const active = tabs.value.find((tab) => tab.relativePath === stored.activePath)
    if (active) activeTabId.value = active.id
    persistTabs()
  }

  async function restore(): Promise<void> {
    restoring.value = true
    try {
      const result = await window.yocim.workspace.current()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      if (!result.data) return
      info.value = result.data
      await resetWorkspace()
      await restoreTabs()
    } finally {
      restoring.value = false
    }
  }

  async function select(): Promise<void> {
    busy.value = true
    clearError()
    try {
      const result = await window.yocim.workspace.select()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      if (!result.data) return
      writeStoredTabs([], null)
      info.value = result.data
      await resetWorkspace()
    } finally {
      busy.value = false
    }
  }

  async function openProject(projectId: string): Promise<boolean> {
    busy.value = true
    clearError()
    try {
      const result = await window.yocim.workspace.openProject({ projectId })
      if (!result.ok) {
        setError(result.error.message)
        return false
      }
      writeStoredTabs([], null)
      info.value = result.data
      await resetWorkspace()
      return true
    } finally {
      busy.value = false
    }
  }

  function ensureTabCapacity(): void {
    while (tabs.value.length >= MAX_EDITOR_TABS) {
      const previewIndex = tabs.value.findIndex((tab) => tab.isPreview)
      const removableIndex =
        previewIndex >= 0
          ? previewIndex
          : tabs.value.findIndex((tab) => tab.content === tab.savedContent)
      const index = removableIndex >= 0 ? removableIndex : 0
      tabs.value.splice(index, 1)
    }
  }

  interface OpenOptions {
    pin?: boolean
    reveal?: RevealRequest
  }

  async function openPath(relativePath: string, options: OpenOptions = {}): Promise<void> {
    clearError()
    const existing = tabs.value.find((tab) => tab.relativePath === relativePath)
    if (existing) {
      activeTabId.value = existing.id
      if (options.pin) existing.isPreview = false
      selectedPath.value = relativePath
      if (options.reveal) requestReveal(options.reveal.line, options.reveal.column)
      persistTabs()
      void checkExternalChange(existing)
      return
    }

    const result = await window.yocim.workspace.readFile({ relativePath })
    if (!result.ok) {
      // 二进制 / 读取失败仍打开只读标签，明确提示不可编辑
      setError(result.error.message)
      const fallback: EditorTab = {
        id: createTabId(),
        relativePath,
        content: '',
        savedContent: '',
        contentHash: '',
        eol: 'lf',
        size: 0,
        truncated: false,
        readOnly: true,
        isPreview: !options.pin,
        kind: 'binary',
        loadError: result.error.message,
        disk: null
      }
      ensureTabCapacity()
      tabs.value.push(fallback)
      activeTabId.value = fallback.id
      selectedPath.value = relativePath
      persistTabs()
      return
    }

    const data = toTabData(result.data)
    const preview = !options.pin ? tabs.value.find((tab) => tab.isPreview) : undefined
    let tab: EditorTab
    if (preview) {
      Object.assign(preview, data, { isPreview: true })
      tab = preview
    } else {
      ensureTabCapacity()
      tab = { id: createTabId(), isPreview: !options.pin, ...data }
      tabs.value.push(tab)
    }
    activeTabId.value = tab.id
    selectedPath.value = relativePath
    if (options.reveal) requestReveal(options.reveal.line, options.reveal.column)
    persistTabs()
  }

  async function openFile(node: FsTreeNode, options: { pin?: boolean } = {}): Promise<void> {
    await openPath(node.relativePath, options)
  }

  function pinActiveFile(): void {
    const tab = activeTab.value
    if (tab) tab.isPreview = false
    persistTabs()
  }

  function activateTab(id: string): void {
    const tab = tabs.value.find((item) => item.id === id)
    if (!tab) return
    activeTabId.value = id
    selectedPath.value = tab.relativePath
    persistTabs()
    void checkExternalChange(tab)
  }

  function updateContent(id: string, content: string): void {
    const tab = tabs.value.find((item) => item.id === id)
    if (tab && tab.kind === 'text') tab.content = content
  }

  function closeTab(id: string): void {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    if (index < 0) return
    tabs.value.splice(index, 1)
    if (activeTabId.value === id) {
      const next = tabs.value[Math.min(index, tabs.value.length - 1)]
      activeTabId.value = next?.id ?? null
    }
    persistTabs()
  }

  function closeAllTabs(): void {
    tabs.value = []
    activeTabId.value = null
    persistTabs()
  }

  function applyDiskToTab(tab: EditorTab, result: FsReadFileResult): void {
    Object.assign(tab, toTabData(result))
    timelineVersion.value += 1
  }

  async function checkExternalChange(tab: EditorTab): Promise<void> {
    if (tab.kind !== 'text' || !tab.contentHash || tab.content !== tab.savedContent) return
    const result = await window.yocim.workspace.readFile({
      relativePath: tab.relativePath,
      expectedHash: tab.contentHash
    })
    if (!result.ok) return
    if (result.data.contentHash && result.data.contentHash !== tab.contentHash) {
      applyDiskToTab(tab, result.data)
    }
  }

  /** 替换 / 恢复后同步指定标签；脏标签由用户自行决定是否放弃修改。 */
  async function reloadTab(relativePath: string, force = false): Promise<void> {
    const tab = tabs.value.find((item) => item.relativePath === relativePath)
    if (!tab || (!force && tab.content !== tab.savedContent)) return
    const result = await window.yocim.workspace.readFile({ relativePath })
    if (!result.ok) return
    applyDiskToTab(tab, result.data)
  }

  async function reloadActiveFile(): Promise<void> {
    const tab = activeTab.value
    if (!tab) return
    const result = await window.yocim.workspace.readFile({ relativePath: tab.relativePath })
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    applyDiskToTab(tab, result.data)
  }

  /** 保存 / 覆盖 / 另存；冲突时返回磁盘版本，由 UI 提供三种处理方式。 */
  async function saveActiveFile(
    options: { force?: boolean; targetPath?: string; content?: string } = {}
  ): Promise<FsWriteFileResult | null> {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'text' || tab.readOnly || saving.value) return null
    const content = options.content ?? tab.content
    saving.value = true
    clearError()
    try {
      const result = await window.yocim.workspace.writeFile({
        relativePath: tab.relativePath,
        content,
        expectedHash: tab.contentHash || undefined,
        eol: tab.eol,
        force: options.force ?? false,
        ...(options.targetPath ? { targetPath: options.targetPath, createIfMissing: true } : {})
      })
      if (!result.ok) {
        setError(result.error.message)
        return null
      }
      if (result.data.status === 'conflict') {
        tab.disk = result.data.disk
        return result.data
      }
      if (options.targetPath) {
        await openPath(result.data.relativePath, { pin: true })
      } else {
        const version = result.data.version
        tab.content = version.content
        tab.savedContent = version.content
        tab.contentHash = version.contentHash
        tab.eol = version.eol
        tab.size = version.size
        tab.disk = null
      }
      timelineVersion.value += 1
      return result.data
    } finally {
      saving.value = false
    }
  }

  /** 重新加载磁盘版本并丢弃本地未保存修改（冲突对话框「重新加载」）。 */
  async function resolveConflictWithDisk(): Promise<void> {
    const tab = activeTab.value
    if (!tab?.disk) return
    Object.assign(tab, {
      content: tab.disk.content,
      savedContent: tab.disk.content,
      contentHash: tab.disk.contentHash,
      eol: tab.disk.eol,
      size: tab.disk.size,
      disk: null
    })
    await reloadActiveFile()
  }

  function clearConflict(): void {
    const tab = activeTab.value
    if (tab) tab.disk = null
  }

  function setCursorLine(line: number): void {
    cursorLine.value = line
  }

  function requestReveal(
    line: number,
    column = 1,
    endColumn?: number,
    options: { keepView?: boolean } = {}
  ): void {
    pendingReveal.value = {
      line,
      column,
      ...(endColumn ? { endColumn } : {}),
      ...(options.keepView ? { keepView: true } : {})
    }
  }

  function clearReveal(): void {
    pendingReveal.value = null
  }

  function openDiff(value: EditorDiff): void {
    diff.value = value
  }

  function closeDiff(): void {
    diff.value = null
  }

  async function createEntry(
    parentPath: string,
    name: string,
    type: 'file' | 'directory'
  ): Promise<boolean> {
    clearError()
    const result =
      type === 'file'
        ? await window.yocim.workspace.createFile({ parentPath, name })
        : await window.yocim.workspace.createFolder({ parentPath, name })
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    if (parentPath) expanded.value.add(parentPath)
    await refreshTree()
    selectedPath.value = result.data.relativePath
    return true
  }

  async function renameEntry(relativePath: string, newName: string): Promise<boolean> {
    clearError()
    const result = await window.yocim.workspace.rename({ relativePath, newName })
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    const nextPath = result.data.relativePath
    const isDir = result.data.type === 'directory'
    for (const tab of tabs.value) {
      if (tab.relativePath === relativePath) tab.relativePath = nextPath
      else if (isDir && tab.relativePath.startsWith(`${relativePath}/`)) {
        tab.relativePath = `${nextPath}${tab.relativePath.slice(relativePath.length)}`
      }
    }
    if (selectedPath.value === relativePath) selectedPath.value = nextPath
    await refreshTree()
    await refreshClipboard()
    persistTabs()
    return true
  }

  async function deleteEntry(relativePath: string): Promise<boolean> {
    clearError()
    const result = await window.yocim.workspace.delete({ relativePath })
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    const affected = tabs.value.filter(
      (tab) => tab.relativePath === relativePath || tab.relativePath.startsWith(`${relativePath}/`)
    )
    for (const tab of affected) closeTab(tab.id)
    expanded.value.delete(relativePath)
    delete childrenByDir.value[relativePath]
    await refreshTree()
    await refreshClipboard()
    if (selectedPath.value === relativePath) selectedPath.value = null
    return true
  }

  async function transfer(
    sourcePath: string,
    targetDir: string,
    conflict: FsConflictResolution,
    mode: 'cut' | 'copy'
  ): Promise<IpcResult<FsTransferResult>> {
    clearError()
    const result =
      mode === 'cut'
        ? await window.yocim.workspace.move({ sourcePath, targetDir, conflict })
        : await window.yocim.workspace.copy({ sourcePath, targetDir, conflict })
    if (result.ok) {
      if (targetDir) expanded.value.add(targetDir)
      if (mode === 'cut' && !result.data.skipped) {
        for (const tab of tabs.value) {
          if (tab.relativePath === sourcePath) tab.relativePath = result.data.relativePath
        }
        persistTabs()
      }
      await refreshTree()
      await refreshClipboard()
    } else if (result.error.code !== 'E_EXISTS') {
      setError(result.error.message)
    }
    return result
  }

  async function paste(
    targetDir: string,
    conflict: FsConflictResolution = 'error'
  ): Promise<IpcResult<FsTransferResult> | null> {
    const clip = clipboard.value
    if (!clip) return null
    return transfer(clip.relativePath, targetDir, conflict, clip.mode)
  }

  async function reveal(relativePath: string): Promise<void> {
    const result = await window.yocim.workspace.reveal({ relativePath })
    if (!result.ok) setError(result.error.message)
  }

  async function copyText(text: string): Promise<void> {
    const result = await window.yocim.clipboard.writeText({ text })
    if (!result.ok) setError(result.error.message)
  }

  return {
    info,
    tree,
    childrenByDir,
    expanded,
    loadingDirs,
    clipboard,
    selectedPath,
    tabs,
    activeTabId,
    activeTab,
    activeFile,
    isPreview,
    isDirty,
    saving,
    timelineVersion,
    error,
    busy,
    restoring,
    cursorLine,
    pendingReveal,
    diff,
    setError,
    clearError,
    childrenOf,
    loadChildren,
    refreshTree,
    toggleDir,
    collapseAll,
    refreshClipboard,
    setClipboard,
    clearClipboard,
    restore,
    select,
    openProject,
    openFile,
    openPath,
    pinActiveFile,
    activateTab,
    updateContent,
    closeTab,
    closeAllTabs,
    saveActiveFile,
    resolveConflictWithDisk,
    clearConflict,
    reloadTab,
    reloadActiveFile,
    setCursorLine,
    requestReveal,
    clearReveal,
    openDiff,
    closeDiff,
    createEntry,
    renameEntry,
    deleteEntry,
    transfer,
    paste,
    reveal,
    copyText
  }
})
