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
export const SESSION_WIDTH_MAX = 360
export const WORKSPACE_WIDTH_MIN = 220
export const WORKSPACE_WIDTH_MAX_RATIO = 0.6
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
  workspaceWidth: 'yocim.ui.workspaceWidth',
  fontSize: 'yocim.ui.fontSize',
  wordWrap: 'yocim.ui.wordWrap',
  minimap: 'yocim.ui.minimap'
} as const

export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 24
export const FONT_SIZE_DEFAULT = 13

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
  const raw = readStorage(key)
  // 注意：Number(null) 是 0 而不是 NaN，必须先判空
  if (raw === null) return fallback
  return clampWidth(Number(raw), min, max, fallback)
}

/** 工作区栏最大宽度：屏幕宽度的 3/5（不低于最小宽度）。 */
export function workspaceWidthMax(viewportWidth: number = window.innerWidth): number {
  return Math.max(WORKSPACE_WIDTH_MIN, Math.round(viewportWidth * WORKSPACE_WIDTH_MAX_RATIO))
}

function clampWorkspaceWidth(value: number, fallback = WORKSPACE_WIDTH_DEFAULT): number {
  const next = Number.isFinite(value) ? value : fallback
  return Math.min(workspaceWidthMax(), Math.max(WORKSPACE_WIDTH_MIN, Math.round(next)))
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

function readFontSize(): number {
  const raw = readStorage(STORAGE_KEYS.fontSize)
  // 注意：Number(null) 是 0 而不是 NaN，必须先判空
  if (raw === null) return FONT_SIZE_DEFAULT
  const value = Number(raw)
  if (!Number.isFinite(value)) return FONT_SIZE_DEFAULT
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

function readWordWrap(): 'on' | 'off' {
  return readStorage(STORAGE_KEYS.wordWrap) === 'on' ? 'on' : 'off'
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>(readTheme())
  const fontSize = ref(readFontSize())
  const wordWrap = ref<'on' | 'off'>(readWordWrap())
  const minimap = ref(readBoolean(STORAGE_KEYS.minimap, true))

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
  const storedWorkspaceWidth = readStorage(STORAGE_KEYS.workspaceWidth)
  const workspaceWidth = ref(
    clampWorkspaceWidth(
      storedWorkspaceWidth === null ? WORKSPACE_WIDTH_DEFAULT : Number(storedWorkspaceWidth)
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

  function setFontSize(value: number): void {
    fontSize.value = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
    writeStorage(STORAGE_KEYS.fontSize, String(fontSize.value))
  }

  function setWordWrap(value: 'on' | 'off'): void {
    wordWrap.value = value
    writeStorage(STORAGE_KEYS.wordWrap, value)
  }

  function setMinimap(value: boolean): void {
    minimap.value = value
    writeStorage(STORAGE_KEYS.minimap, String(value))
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
    workspaceWidth.value = clampWorkspaceWidth(value)
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
    setFontSize,
    setWordWrap,
    setMinimap,
    setSessionCollapsed,
    setWorkspaceCollapsed,
    setStatusExpanded,
    setWorkspaceView,
    setSectionCollapsed,
    setSessionWidth,
    setWorkspaceWidth
  }
})
