import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { FsTreeNode, WorkspaceInfo } from '@shared/ipc'

export interface OpenedFile {
  relativePath: string
  content: string
  truncated: boolean
  size: number
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const info = ref<WorkspaceInfo | null>(null)
  const tree = ref<FsTreeNode[]>([])
  const activeFile = ref<OpenedFile | null>(null)
  const error = ref('')
  const busy = ref(false)
  const restoring = ref(false)

  function setError(message: string): void {
    error.value = message
  }

  function clearError(): void {
    error.value = ''
  }

  async function refreshTree(): Promise<void> {
    const result = await window.yocim.workspace.tree({ relativePath: '', depth: 3 })
    if (result.ok) {
      tree.value = result.data
    } else {
      setError(result.error.message)
    }
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
      await refreshTree()
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
      activeFile.value = null
      tree.value = []
      await refreshTree()
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
      activeFile.value = null
      tree.value = []
      await refreshTree()
      return true
    } finally {
      busy.value = false
    }
  }

  async function openFile(node: FsTreeNode): Promise<void> {
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
  }

  return {
    info,
    tree,
    activeFile,
    error,
    busy,
    restoring,
    setError,
    clearError,
    refreshTree,
    restore,
    select,
    openProject,
    openFile
  }
})
