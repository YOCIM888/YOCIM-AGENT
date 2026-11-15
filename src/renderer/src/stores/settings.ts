import { defineStore } from 'pinia'
import { ref } from 'vue'
import { isWorkspaceView, type WorkspaceView } from '../lib/workspaceViews'

export type ThemeMode = 'light' | 'dark'

export type WorkspaceSection =
  | 'outline'
  | 'timeline'
  | 'runConfigs'
  | 'runTasks'
  | 'debugVariables'
  | 'debugWatches'
  | 'debugCallstack'
  | 'debugBreakpoints'
  | 'debugConsole'
  | 'runOutput'

export interface WorkspaceSections {
  outline: boolean
  timeline: boolean
  runConfigs: boolean
  runTasks: boolean
  debugVariables: boolean
  debugWatches: boolean
  debugCallstack: boolean
  debugBreakpoints: boolean
  debugConsole: boolean
  runOutput: boolean
}

export const SESSION_WIDTH_MIN = 220
export const SESSION_WIDTH_MAX = 420
export const WORKSPACE_WIDTH_MIN = 220
export const WORKSPACE_WIDTH_MAX = 420
export const SESSION_WIDTH_DEFAULT = 300
export const WORKSPACE_WIDTH_DEFAULT = 280

const STORAGE_KEYS = {
  theme: 'yocim.theme',
  sessionCollapsed: 'yocim.ui.sessionCollapsed',
  workspaceCollapsed: 'yocim.ui.workspaceCollapsed',
  statusExpanded: 'yocim.ui.statusExpanded',
  workspaceView: 'yocim.ui.workspaceView',
  workspaceSections: 'yocim.ui.workspaceSections',
  sessionWidth: 'yocim.ui.sessionWidth',
  workspaceWidth: 'yocim.ui.workspaceWidth'
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

function clampWidth(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function readWidth(key: string, min: number, max: number, fallback: number): number {
  return clampWidth(Number(readStorage(key)), min, max, fallback)
}

function readTheme(): ThemeMode {
  return readStorage(STORAGE_KEYS.theme) === 'dark' ? 'dark' : 'light'
}

function readView(): WorkspaceView {
  const value = readStorage(STORAGE_KEYS.workspaceView) ?? readStorage('yocim.ui.workspaceTab')
  return isWorkspaceView(value) ? value : 'files'
}

function readSections(): WorkspaceSections {
  const fallback: WorkspaceSections = {
    outline: true,
    timeline: true,
    runConfigs: false,
    runTasks: false,
    debugVariables: false,
    debugWatches: false,
    debugCallstack: false,
    debugBreakpoints: false,
    debugConsole: false,
    runOutput: false
  }
  const raw = readStorage(STORAGE_KEYS.workspaceSections)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceSections>
    return {
      outline: typeof parsed.outline === 'boolean' ? parsed.outline : true,
      timeline: typeof parsed.timeline === 'boolean' ? parsed.timeline : true,
      runConfigs: parsed.runConfigs === true,
      runTasks: parsed.runTasks === true,
      debugVariables: parsed.debugVariables === true,
      debugWatches: parsed.debugWatches === true,
      debugCallstack: parsed.debugCallstack === true,
      debugBreakpoints: parsed.debugBreakpoints === true,
      debugConsole: parsed.debugConsole === true,
      runOutput: parsed.runOutput === true
    }
  } catch {
    return fallback
  }
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
  const workspaceView = ref<WorkspaceView>(readView())
  const workspaceSections = ref<WorkspaceSections>(readSections())
  const sessionWidth = ref(
    readWidth(
      STORAGE_KEYS.sessionWidth,
      SESSION_WIDTH_MIN,
      SESSION_WIDTH_MAX,
      SESSION_WIDTH_DEFAULT
    )
  )
  const workspaceWidth = ref(
    readWidth(
      STORAGE_KEYS.workspaceWidth,
      WORKSPACE_WIDTH_MIN,
      WORKSPACE_WIDTH_MAX,
      WORKSPACE_WIDTH_DEFAULT
    )
  )

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

  function setWorkspaceView(value: WorkspaceView): void {
    workspaceView.value = value
    writeStorage(STORAGE_KEYS.workspaceView, value)
  }

  function setSectionCollapsed(section: WorkspaceSection, collapsed: boolean): void {
    workspaceSections.value[section] = collapsed
    writeStorage(STORAGE_KEYS.workspaceSections, JSON.stringify(workspaceSections.value))
  }

  function setSessionWidth(value: number): void {
    sessionWidth.value = clampWidth(
      value,
      SESSION_WIDTH_MIN,
      SESSION_WIDTH_MAX,
      SESSION_WIDTH_DEFAULT
    )
    writeStorage(STORAGE_KEYS.sessionWidth, String(sessionWidth.value))
  }

  function setWorkspaceWidth(value: number): void {
    workspaceWidth.value = clampWidth(
      value,
      WORKSPACE_WIDTH_MIN,
      WORKSPACE_WIDTH_MAX,
      WORKSPACE_WIDTH_DEFAULT
    )
    writeStorage(STORAGE_KEYS.workspaceWidth, String(workspaceWidth.value))
  }

  return {
    theme,
    fontSize,
    wordWrap,
    minimap,
    sessionCollapsed,
    workspaceCollapsed,
    statusExpanded,
    workspaceView,
    workspaceSections,
    sessionWidth,
    workspaceWidth,
    setTheme,
    toggleTheme,
    setSessionCollapsed,
    setWorkspaceCollapsed,
    setStatusExpanded,
    setWorkspaceView,
    setSectionCollapsed,
    setSessionWidth,
    setWorkspaceWidth
  }
})
