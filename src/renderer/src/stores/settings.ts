import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ThemeMode = 'light' | 'dark'
export type WorkspaceTab = 'files' | 'editor' | 'audit'

const STORAGE_KEYS = {
  theme: 'yocim.theme',
  sessionCollapsed: 'yocim.ui.sessionCollapsed',
  workspaceCollapsed: 'yocim.ui.workspaceCollapsed',
  statusExpanded: 'yocim.ui.statusExpanded',
  workspaceTab: 'yocim.ui.workspaceTab'
} as const

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 本地偏好写入失败不影响使用
  }
}

function readBoolean(key: string, fallback: boolean): boolean {
  const value = readStorage(key)
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function readTheme(): ThemeMode {
  return readStorage(STORAGE_KEYS.theme) === 'dark' ? 'dark' : 'light'
}

function readTab(): WorkspaceTab {
  const value = readStorage(STORAGE_KEYS.workspaceTab)
  return value === 'editor' || value === 'audit' ? value : 'files'
}

function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>(readTheme())
  const fontSize = ref(13)
  const wordWrap = ref<'on' | 'off'>('off')
  const minimap = ref(true)

  const sessionCollapsed = ref(readBoolean(STORAGE_KEYS.sessionCollapsed, false))
  const workspaceCollapsed = ref(readBoolean(STORAGE_KEYS.workspaceCollapsed, false))
  const statusExpanded = ref(readBoolean(STORAGE_KEYS.statusExpanded, false))
  const workspaceTab = ref<WorkspaceTab>(readTab())

  applyTheme(theme.value)

  function setTheme(next: ThemeMode): void {
    theme.value = next
    applyTheme(next)
    writeStorage(STORAGE_KEYS.theme, next)
  }

  function toggleTheme(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  function setSessionCollapsed(value: boolean): void {
    sessionCollapsed.value = value
    writeStorage(STORAGE_KEYS.sessionCollapsed, String(value))
  }

  function setWorkspaceCollapsed(value: boolean): void {
    workspaceCollapsed.value = value
    writeStorage(STORAGE_KEYS.workspaceCollapsed, String(value))
  }

  function setStatusExpanded(value: boolean): void {
    statusExpanded.value = value
    writeStorage(STORAGE_KEYS.statusExpanded, String(value))
  }

  function setWorkspaceTab(value: WorkspaceTab): void {
    workspaceTab.value = value
    writeStorage(STORAGE_KEYS.workspaceTab, value)
  }

  return {
    theme,
    fontSize,
    wordWrap,
    minimap,
    sessionCollapsed,
    workspaceCollapsed,
    statusExpanded,
    workspaceTab,
    setTheme,
    toggleTheme,
    setSessionCollapsed,
    setWorkspaceCollapsed,
    setStatusExpanded,
    setWorkspaceTab
  }
})
