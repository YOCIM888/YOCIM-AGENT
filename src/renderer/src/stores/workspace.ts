import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  FsClipboardState,
  FsConflictResolution,
  FsTransferResult,
  FsTreeNode,
  IpcResult,
  WorkspaceInfo
} from '@shared/ipc'

export interface OpenedFile {
  relativePath: string
  content: string
  truncated: boolean
  size: number
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
}

export function parentOf(relativePath: string): string {
  const index = relativePath.lastIndexOf('/')
  return index >= 0 ? relativePath.slice(0, index) : ''
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const info = ref<WorkspaceInfo | null>(null)
  const tree = ref<FsTreeNode[]>([])
  const childrenByDir = ref<Record<string, FsTreeNode[]>>({})
  const expanded = ref<Set<string>>(new Set())
  const loadingDirs = ref<Set<string>>(new Set())
  const clipboard = ref<FsClipboardState | null>(null)
  const selectedPath = ref<string | null>(null)
  const activeFile = ref<OpenedFile | null>(null)
  const isPreview = ref(false)
  const error = ref('')
  const busy = ref(false)
  const restoring = ref(false)
  const cursorLine = ref(1)
  const pendingReveal = ref<RevealRequest | null>(null)
  const diff = ref<EditorDiff | null>(null)

  function setError(message: string): void {
    error.value = message
  }

  function clearError(): void {
    error.value = ''
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
    activeFile.value = null
    isPreview.value = false
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
      info.value = result.data
      await resetWorkspace()
      return true
    } finally {
      busy.value = false
    }
  }

  async function openFile(node: FsTreeNode, options: { pin?: boolean } = {}): Promise<void> {
    clearError()
    const result = await window.yocim.workspace.readFile({ relativePath: node.relativePath })
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    activeFile.value = {
      relativePath: result.data.relativePath,
      content: result.data.content,
      truncated: result.data.truncated,
      size: result.data.size
    }
    isPreview.value = !options.pin
    selectedPath.value = node.relativePath
  }

  function pinActiveFile(): void {
    isPreview.value = false
  }

  function setCursorLine(line: number): void {
    cursorLine.value = line
  }

  function requestReveal(line: number, column = 1): void {
    pendingReveal.value = { line, column }
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

  async function reloadActiveFile(): Promise<void> {
    const file = activeFile.value
    if (!file) return
    const result = await window.yocim.workspace.readFile({ relativePath: file.relativePath })
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    activeFile.value = {
      relativePath: result.data.relativePath,
      content: result.data.content,
      truncated: result.data.truncated,
      size: result.data.size
    }
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
    await refreshTree()
    await refreshClipboard()
    if (activeFile.value?.relativePath === relativePath) {
      activeFile.value = { ...activeFile.value, relativePath: result.data.relativePath }
    }
    selectedPath.value = result.data.relativePath
    return true
  }

  async function deleteEntry(relativePath: string): Promise<boolean> {
    clearError()
    const result = await window.yocim.workspace.delete({ relativePath })
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    if (activeFile.value?.relativePath === relativePath) {
      activeFile.value = null
      isPreview.value = false
    }
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
    activeFile,
    isPreview,
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
    pinActiveFile,
    setCursorLine,
    requestReveal,
    clearReveal,
    openDiff,
    closeDiff,
    reloadActiveFile,
    createEntry,
    renameEntry,
    deleteEntry,
    transfer,
    paste,
    reveal,
    copyText
  }
})
