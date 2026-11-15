import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ProjectSummary } from '@shared/session'

const STORAGE_KEY = 'yocim.ui.expandedProjects'

function readExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function writeExpanded(value: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // UI 偏好写入失败不影响使用
  }
}

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<ProjectSummary[]>([])
  const error = ref('')
  const expanded = ref<Record<string, boolean>>(readExpanded())

  async function refresh(): Promise<void> {
    const result = await window.yocim.projects.list()
    if (result.ok) {
      projects.value = result.data
    } else {
      error.value = result.error.message
    }
  }

  function isExpanded(projectId: string): boolean {
    return expanded.value[projectId] !== false
  }

  function toggleExpanded(projectId: string): void {
    expanded.value = {
      ...expanded.value,
      [projectId]: !isExpanded(projectId)
    }
    writeExpanded(expanded.value)
  }

  async function renameProject(projectId: string, name: string): Promise<boolean> {
    const result = await window.yocim.projects.rename({ projectId, name })
    if (!result.ok) {
      error.value = result.error.message
      return false
    }
    const index = projects.value.findIndex((project) => project.id === projectId)
    if (index >= 0) projects.value[index] = result.data
    return true
  }

  function clearError(): void {
    error.value = ''
  }

  return {
    projects,
    error,
    expanded,
    refresh,
    isExpanded,
    toggleExpanded,
    renameProject,
    clearError
  }
})
