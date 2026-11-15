import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import type {
  DebugBreakpoint,
  DebugConfig,
  DebugConfigFile,
  DebugEvaluation,
  DebugEvent,
  DebugScope,
  DebugSession,
  DebugStackFrame,
  DebugVariable
} from '@shared/debug'
import { useSettingsStore, type WorkspaceSection } from './settings'
import { useWorkspaceStore } from './workspace'

/** 调试开始/暂停时需要展开的面板区块，否则关键信息被折叠隐藏。 */
const REVEAL_SECTIONS: WorkspaceSection[] = [
  'debugBreakpoints',
  'debugVariables',
  'debugWatches',
  'debugCallstack',
  'debugConsole'
]

export interface WatchResult {
  expression: string
  value: string
  error?: string
}

export interface DebugConsoleLine {
  id: number
  category: 'stdout' | 'stderr' | 'console' | 'event'
  text: string
}

const BREAKPOINTS_KEY = 'yocim.debug.breakpoints'
const WATCHES_KEY = 'yocim.debug.watches'
const MAX_CONSOLE_LINES = 2000

interface StoredBreakpoints {
  root: string
  list: DebugBreakpoint[]
}

function readBreakpoints(root: string | null): DebugBreakpoint[] {
  try {
    const raw = localStorage.getItem(BREAKPOINTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredBreakpoints
    if (!parsed || parsed.root !== root || !Array.isArray(parsed.list)) return []
    return parsed.list.filter(
      (item) => typeof item?.relativePath === 'string' && Number.isFinite(item?.line)
    )
  } catch {
    return []
  }
}

function writeBreakpoints(root: string | null, list: DebugBreakpoint[]): void {
  if (!root) return
  try {
    localStorage.setItem(BREAKPOINTS_KEY, JSON.stringify({ root, list }))
  } catch {
    // 忽略本地存储失败
  }
}

function readWatches(): string[] {
  try {
    const raw = localStorage.getItem(WATCHES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 30)
      : []
  } catch {
    return []
  }
}

function plainBreakpoint(bp: DebugBreakpoint): {
  id: string
  relativePath: string
  line: number
  enabled: boolean
  condition?: string
} {
  return {
    id: bp.id,
    relativePath: bp.relativePath,
    line: bp.line,
    enabled: bp.enabled,
    ...(bp.condition ? { condition: bp.condition } : {})
  }
}

export const useDebugStore = defineStore('debug', () => {
  const workspace = useWorkspaceStore()

  const configFile = ref<DebugConfigFile | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  const session = ref<DebugSession | null>(null)
  const frames = ref<DebugStackFrame[]>([])
  const selectedFrameId = ref<string | null>(null)
  const scopes = ref<DebugScope[]>([])
  const variableCache = reactive<Record<string, DebugVariable[]>>({})
  const expandedVars = reactive<Record<string, boolean>>({})
  const watchExpressions = ref<string[]>(readWatches())
  const watchResults = ref<WatchResult[]>([])
  const consoleLines = ref<DebugConsoleLine[]>([])
  const breakpoints = ref<DebugBreakpoint[]>(readBreakpoints(workspace.info?.root ?? null))
  const busy = ref(false)
  let listening = false
  let consoleId = 0

  const configs = computed<DebugConfig[]>(() => configFile.value?.configs ?? [])
  const status = computed(() => session.value?.status ?? 'idle')
  const isActive = computed(
    () =>
      Boolean(session.value) &&
      session.value?.status !== 'stopped' &&
      session.value?.status !== 'error'
  )
  const isPaused = computed(() => session.value?.status === 'paused')
  const selectedFrame = computed(
    () => frames.value.find((frame) => frame.id === selectedFrameId.value) ?? null
  )
  const pauseLocation = computed(() => {
    const frame = selectedFrame.value
    if (!frame || !frame.relativePath || frame.line === null) return null
    return { relativePath: frame.relativePath, line: frame.line }
  })
  const consoleText = computed(() => consoleLines.value.map((line) => line.text).join(''))
  const breakpointsForActiveFile = computed(() => {
    const path = workspace.activeTab?.relativePath
    return path ? breakpoints.value.filter((bp) => bp.relativePath === path) : []
  })

  function appendConsole(category: DebugConsoleLine['category'], text: string): void {
    if (!text) return
    consoleLines.value.push({ id: ++consoleId, category, text })
    if (consoleLines.value.length > MAX_CONSOLE_LINES) {
      consoleLines.value.splice(0, consoleLines.value.length - MAX_CONSOLE_LINES)
    }
  }

  function clearTransient(): void {
    frames.value = []
    selectedFrameId.value = null
    scopes.value = []
    for (const key of Object.keys(variableCache)) delete variableCache[key]
    for (const key of Object.keys(expandedVars)) delete expandedVars[key]
  }

  function revealSections(): void {
    const settings = useSettingsStore()
    for (const section of REVEAL_SECTIONS) {
      if (settings.workspaceSections[section]) settings.setSectionCollapsed(section, false)
    }
  }

  function handleEvent(event: DebugEvent): void {
    if (event.type === 'session') {
      const previous = session.value?.status
      const wasIdle = !session.value
      session.value = event.session
      if (wasIdle) revealSections()
      // CDP 会为同一次恢复推送多条 resumed，只在「暂停 → 运行」时记一行
      if (event.session.status === 'paused') appendConsole('event', '已暂停\n')
      else if (event.session.status === 'running' && previous === 'paused') {
        appendConsole('event', '继续运行…\n')
      }
      return
    }
    if (event.type === 'output') {
      appendConsole(event.category, event.text)
      return
    }
    if (event.type === 'paused') {
      const info = event.info
      frames.value = info.frames
      const preferred =
        info.frames.find((frame) => frame.relativePath)?.id ?? info.frames[0]?.id ?? null
      selectedFrameId.value = preferred
      appendConsole(
        'event',
        `⏸ 命中断点（${info.reason}）${info.frames[0]?.relativePath ? ` · ${info.frames[0].relativePath}:${info.frames[0].line}` : ''}\n`
      )
      if (preferred) void loadFrame(preferred)
      void evaluateWatches()
      return
    }
    if (event.type === 'resumed') {
      clearTransient()
      return
    }
    if (event.type === 'breakpoints') {
      mergeBreakpoints(event.breakpoints)
      return
    }
    if (event.type === 'exited') {
      clearTransient()
      appendConsole(
        'event',
        `■ 调试结束${event.code === null ? '' : `（code ${event.code}）`}${event.message ? `：${event.message}` : ''}\n`
      )
    }
  }

  function ensureListener(): void {
    if (listening) return
    listening = true
    window.yocim.debug.onEvent(handleEvent)
  }

  function mergeBreakpoints(incoming: DebugBreakpoint[]): void {
    const byId = new Map(incoming.map((bp) => [bp.id, bp]))
    breakpoints.value = breakpoints.value.map((bp) => {
      const next = byId.get(bp.id)
      return next ? { ...bp, verified: next.verified } : bp
    })
  }

  async function refreshConfigs(): Promise<void> {
    ensureListener()
    loading.value = true
    try {
      const result = await window.yocim.debug.configs()
      if (!result.ok) {
        error.value = result.error.message
        configFile.value = null
        return
      }
      configFile.value = result.data
      error.value = result.data.error ?? null
    } finally {
      loading.value = false
    }
  }

  function persist(): void {
    writeBreakpoints(workspace.info?.root ?? null, breakpoints.value)
  }

  async function pushBreakpoints(): Promise<void> {
    if (!isActive.value) return
    const result = await window.yocim.debug.setBreakpoints({
      breakpoints: breakpoints.value.map(plainBreakpoint)
    })
    if (result.ok) mergeBreakpoints(result.data)
  }

  function findBreakpoint(relativePath: string, line: number): DebugBreakpoint | undefined {
    return breakpoints.value.find((bp) => bp.relativePath === relativePath && bp.line === line)
  }

  async function toggleBreakpoint(relativePath: string, line: number): Promise<void> {
    const existing = findBreakpoint(relativePath, line)
    if (existing) {
      breakpoints.value = breakpoints.value.filter((bp) => bp.id !== existing.id)
    } else {
      breakpoints.value = [
        ...breakpoints.value,
        {
          id: `bp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          relativePath,
          line,
          enabled: true
        }
      ]
    }
    persist()
    await pushBreakpoints()
  }

  async function removeBreakpoint(id: string): Promise<void> {
    breakpoints.value = breakpoints.value.filter((bp) => bp.id !== id)
    persist()
    await pushBreakpoints()
  }

  async function setBreakpointCondition(id: string, condition: string): Promise<void> {
    const trimmed = condition.trim()
    breakpoints.value = breakpoints.value.map((bp) =>
      bp.id === id ? { ...bp, condition: trimmed || undefined } : bp
    )
    persist()
    await pushBreakpoints()
  }

  async function start(config: DebugConfig, activeFile?: string): Promise<boolean> {
    ensureListener()
    error.value = null
    notice.value = null
    busy.value = true
    try {
      const result = await window.yocim.debug.start({
        configId: config.id,
        ...(activeFile ? { activeFile } : {}),
        breakpoints: breakpoints.value.map(plainBreakpoint)
      })
      if (!result.ok) {
        error.value = result.error.message
        return false
      }
      session.value = result.data.session
      appendConsole('event', `▶ 启动 ${config.name}\n$ ${result.data.commandLine}\n`)
      return true
    } finally {
      busy.value = false
    }
  }

  async function stop(): Promise<void> {
    busy.value = true
    try {
      await window.yocim.debug.stop()
    } finally {
      busy.value = false
    }
  }

  async function command(
    value: 'continue' | 'pause' | 'stepOver' | 'stepInto' | 'stepOut' | 'restart'
  ): Promise<void> {
    error.value = null
    const result = await window.yocim.debug.command({ command: value })
    if (!result.ok) error.value = result.error.message
  }

  async function loadFrame(frameId: string): Promise<void> {
    selectedFrameId.value = frameId
    const result = await window.yocim.debug.scopes({ frameId })
    if (!result.ok) {
      error.value = result.error.message
      return
    }
    scopes.value = result.data
    for (const scope of result.data) {
      if (scope.type === 'global') continue
      void ensureVariables(scope.variablesReference)
    }
  }

  async function ensureVariables(reference: string): Promise<void> {
    if (!reference || variableCache[reference]) return
    const result = await window.yocim.debug.variables({ variablesReference: reference })
    if (!result.ok) {
      error.value = result.error.message
      return
    }
    variableCache[reference] = result.data
  }

  async function toggleVariable(reference: string): Promise<void> {
    if (!reference) return
    expandedVars[reference] = !expandedVars[reference]
    if (expandedVars[reference]) await ensureVariables(reference)
  }

  async function evaluate(expression: string): Promise<DebugEvaluation | null> {
    const result = await window.yocim.debug.evaluate({
      expression,
      ...(selectedFrameId.value ? { frameId: selectedFrameId.value } : {})
    })
    if (!result.ok)
      return { value: result.error.message, variablesReference: null, error: result.error.message }
    return result.data
  }

  async function evaluateWatches(): Promise<void> {
    if (!watchExpressions.value.length) {
      watchResults.value = []
      return
    }
    const results: WatchResult[] = []
    for (const expression of watchExpressions.value) {
      const evaluation = await evaluate(expression)
      results.push({
        expression,
        value: evaluation?.value ?? '—',
        ...(evaluation?.error ? { error: evaluation.error } : {})
      })
    }
    watchResults.value = results
  }

  function addWatch(expression: string): void {
    const trimmed = expression.trim()
    if (!trimmed || watchExpressions.value.includes(trimmed)) return
    watchExpressions.value = [...watchExpressions.value, trimmed].slice(0, 30)
    try {
      localStorage.setItem(WATCHES_KEY, JSON.stringify(watchExpressions.value))
    } catch {
      // 忽略本地存储失败
    }
    void evaluateWatches()
  }

  function removeWatch(expression: string): void {
    watchExpressions.value = watchExpressions.value.filter((item) => item !== expression)
    try {
      localStorage.setItem(WATCHES_KEY, JSON.stringify(watchExpressions.value))
    } catch {
      // 忽略本地存储失败
    }
    void evaluateWatches()
  }

  function clearConsole(): void {
    consoleLines.value = []
  }

  function reset(): void {
    session.value = null
    clearTransient()
    consoleLines.value = []
    error.value = null
    notice.value = null
    configFile.value = null
  }

  // 切换工作区时断点按根目录隔离：重新读取该工作区的断点
  watch(
    () => workspace.info?.root ?? null,
    (root) => {
      breakpoints.value = readBreakpoints(root)
      if (session.value) void stop()
    }
  )

  return {
    configFile,
    configs,
    loading,
    error,
    notice,
    session,
    status,
    isActive,
    isPaused,
    frames,
    selectedFrameId,
    selectedFrame,
    scopes,
    variableCache,
    expandedVars,
    watchExpressions,
    watchResults,
    consoleLines,
    consoleText,
    breakpoints,
    breakpointsForActiveFile,
    pauseLocation,
    busy,
    refreshConfigs,
    toggleBreakpoint,
    removeBreakpoint,
    setBreakpointCondition,
    start,
    stop,
    command,
    loadFrame,
    ensureVariables,
    toggleVariable,
    evaluate,
    evaluateWatches,
    addWatch,
    removeWatch,
    clearConsole,
    reset
  }
})
