import { defineStore } from 'pinia'
import { computed, ref, toRaw, watch } from 'vue'
import { SEARCH_LIMITS } from '@shared/ipc'
import type {
  SearchEngine,
  SearchEvent,
  SearchFileResult,
  SearchReplaceResult,
  SearchReplaceTarget,
  SearchStartInput
} from '@shared/ipc'
import { useSettingsStore } from './settings'
import { useWorkspaceStore } from './workspace'

const STORAGE_KEY = 'yocim.ui.searchOptions'

export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
  preserveCase: boolean
  includeIgnored: boolean
  onlyOpenEditors: boolean
  showReplace: boolean
  showFilters: boolean
}

const DEFAULT_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  preserveCase: false,
  includeIgnored: false,
  onlyOpenEditors: false,
  showReplace: false,
  showFilters: false
}

function readOptions(): SearchOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_OPTIONS }
    const parsed = JSON.parse(raw) as Partial<SearchOptions>
    const options = { ...DEFAULT_OPTIONS }
    for (const key of Object.keys(DEFAULT_OPTIONS) as (keyof SearchOptions)[]) {
      if (typeof parsed[key] === 'boolean') options[key] = parsed[key] as never
    }
    return options
  } catch {
    return { ...DEFAULT_OPTIONS }
  }
}

interface PendingReplace {
  query: SearchStartInput
  scope: 'single' | 'file' | 'all'
  target?: SearchReplaceTarget
  files: SearchReplaceTarget[]
}

export const useSearchStore = defineStore('search', () => {
  const query = ref('')
  const replaceText = ref('')
  const include = ref('')
  const exclude = ref('')
  const options = ref<SearchOptions>(readOptions())
  const results = ref<SearchFileResult[]>([])
  const expanded = ref<Set<string>>(new Set())
  const loading = ref(false)
  const replacing = ref(false)
  const searchId = ref<string | null>(null)
  const engine = ref<SearchEngine>('builtin')
  const totalMatches = ref(0)
  const totalFiles = ref(0)
  const truncated = ref(false)
  const error = ref('')
  const notice = ref('')
  const preview = ref<SearchReplaceResult | null>(null)
  const previewScope = ref<'single' | 'file' | 'all'>('all')
  // 不放入 ref：IPC 结构化克隆无法序列化 Vue 响应式 Proxy
  let pendingReplace: PendingReplace | null = null

  let debounce: ReturnType<typeof setTimeout> | null = null

  const hasQuery = computed(() => query.value.trim().length > 0)
  const matchCount = computed(() =>
    results.value.reduce((sum, file) => sum + file.matches.length, 0)
  )

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toRaw(options.value)))
    } catch {
      // 本地偏好写入失败不影响使用
    }
  }

  watch(options, persist, { deep: true })

  function setOption(key: keyof SearchOptions, value: boolean): void {
    options.value[key] = value
    persist()
    scheduleSearch()
  }

  function plainQuery(): SearchStartInput {
    const workspace = useWorkspaceStore()
    const current = toRaw(options.value)
    return {
      query: query.value,
      replaceText: replaceText.value,
      caseSensitive: current.caseSensitive,
      wholeWord: current.wholeWord,
      useRegex: current.useRegex,
      preserveCase: current.preserveCase,
      include: include.value,
      exclude: exclude.value,
      includeIgnored: current.includeIgnored,
      onlyOpenEditors: current.onlyOpenEditors,
      openFiles: workspace.tabs.map((tab) => String(tab.relativePath)),
      maxResults: SEARCH_LIMITS.maxResults
    }
  }

  /**
   * 主进程按文件逐个推送命中；若每条都立即 push，上千个结果会触发上千次重渲染，
   * 面板会卡住几十秒。这里按 ~30ms 一批合并成一次数组替换。
   */
  const pendingResults: SearchFileResult[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  /** 结果文件数不超过这个值时自动展开命中行，超过则折叠（避免一次渲染上千行） */
  const AUTO_EXPAND_FILES = 20

  function flushResults(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (!pendingResults.length) return
    const batch = pendingResults.splice(0, pendingResults.length)
    // 一次性合并，只触发一次依赖更新
    results.value = results.value.concat(batch)
    totalFiles.value += batch.length
    for (const file of batch) totalMatches.value += file.matches.length
    if (results.value.length <= AUTO_EXPAND_FILES) {
      for (const file of batch) expanded.value.add(file.relativePath)
    } else if (expanded.value.size) {
      expanded.value.clear()
    }
  }

  function scheduleFlush(): void {
    if (flushTimer !== null) return
    flushTimer = setTimeout(flushResults, 30)
  }

  function handleEvent(event: SearchEvent): void {
    if (!searchId.value || event.searchId !== searchId.value) return
    if (event.kind === 'file' && event.file) {
      const file = event.file
      pendingResults.push({
        relativePath: file.relativePath,
        contentHash: file.contentHash,
        matches: file.matches.map((match) => ({ ...match }))
      })
      scheduleFlush()
      return
    }
    // 结束类事件先落盘已到达的结果，避免最后一批丢失
    flushResults()
    if (event.kind === 'error') {
      error.value = event.message ?? '搜索失败'
      loading.value = false
      return
    }
    if (event.kind === 'cancelled') {
      notice.value = '搜索已取消'
      loading.value = false
      return
    }
    if (event.kind === 'done') {
      loading.value = false
      searchId.value = null
      truncated.value = event.truncated ?? false
      if (event.message) notice.value = event.message
    }
  }

  if (typeof window !== 'undefined' && window.yocim?.search) {
    window.yocim.search.onEvent(handleEvent)
  }

  async function cancelCurrent(): Promise<void> {
    const id = searchId.value
    searchId.value = null
    loading.value = false
    pendingResults.length = 0
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (id) await window.yocim.search.cancel({ searchId: id })
  }

  async function startSearch(): Promise<void> {
    if (debounce) {
      clearTimeout(debounce)
      debounce = null
    }
    await cancelCurrent()
    results.value = []
    expanded.value.clear()
    totalMatches.value = 0
    totalFiles.value = 0
    truncated.value = false
    error.value = ''
    notice.value = ''
    if (!hasQuery.value) return

    const result = await window.yocim.search.start(plainQuery())
    if (!result.ok) {
      error.value = result.error.message
      return
    }
    searchId.value = result.data.searchId
    engine.value = result.data.engine
    loading.value = true
    // 内置搜索提示由 SearchPanel 的 engine notice 统一展示，避免重复两行提示
  }

  function scheduleSearch(): void {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      void startSearch()
    }, 300)
  }

  async function cancelSearch(): Promise<void> {
    if (debounce) {
      clearTimeout(debounce)
      debounce = null
    }
    await cancelCurrent()
    notice.value = '搜索已取消'
  }

  function toggleFile(relativePath: string): void {
    if (expanded.value.has(relativePath)) expanded.value.delete(relativePath)
    else expanded.value.add(relativePath)
  }

  function jump(relativePath: string, line: number, column: number, endColumn?: number): void {
    useSettingsStore().setWorkspaceView('editor')
    void useWorkspaceStore().openPath(relativePath, {
      pin: true,
      reveal: { line, column, ...(endColumn ? { endColumn } : {}) }
    })
  }

  function targetsFor(
    scope: 'single' | 'file' | 'all',
    file?: SearchFileResult,
    matchLine?: number,
    matchColumn?: number
  ) {
    const target: SearchReplaceTarget | undefined =
      scope === 'single' && file
        ? {
            relativePath: file.relativePath,
            hash: file.contentHash,
            line: matchLine,
            column: matchColumn
          }
        : undefined
    const files: SearchReplaceTarget[] =
      scope === 'all'
        ? results.value.map((item) => ({ relativePath: item.relativePath, hash: item.contentHash }))
        : file
          ? [{ relativePath: file.relativePath, hash: file.contentHash }]
          : []
    return { target, files }
  }

  async function requestReplace(
    scope: 'single' | 'file' | 'all',
    file?: SearchFileResult,
    matchLine?: number,
    matchColumn?: number
  ): Promise<void> {
    if (!hasQuery.value || !results.value.length) return
    error.value = ''
    const queryPayload = plainQuery()
    const { target, files } = targetsFor(scope, file, matchLine, matchColumn)
    const result = await window.yocim.search.replace({
      query: queryPayload,
      scope,
      apply: false,
      ...(target ? { target } : {}),
      files
    })
    if (!result.ok) {
      error.value = result.error.message
      return
    }
    preview.value = result.data
    previewScope.value = scope
    pendingReplace = { query: queryPayload, scope, target, files }
  }

  function cancelReplace(): void {
    preview.value = null
    pendingReplace = null
  }

  async function applyReplace(): Promise<void> {
    const pending = pendingReplace
    if (!pending || replacing.value) return
    replacing.value = true
    error.value = ''
    try {
      let result: Awaited<ReturnType<typeof window.yocim.search.replace>>
      try {
        result = await window.yocim.search.replace({
          query: pending.query,
          scope: pending.scope,
          apply: true,
          ...(pending.target ? { target: pending.target } : {}),
          files: pending.files
        })
      } catch {
        error.value = '替换失败：主进程无响应'
        return
      }
      if (!result.ok) {
        error.value = result.error.message
        return
      }
      preview.value = null
      pendingReplace = null
      const replacementError = result.data.conflicts.length
        ? `${result.data.conflicts.length} 个文件在搜索后被修改，已跳过，请重新搜索`
        : ''
      const replacementNotice = `已替换 ${result.data.totalReplaced} 处，替换前版本可在时间线恢复`
      const workspace = useWorkspaceStore()
      for (const file of result.data.files) {
        if (file.status === 'ok' && file.replaced > 0) {
          await workspace.reloadTab(file.relativePath)
        }
      }
      await startSearch()
      if (replacementError) error.value = replacementError
      else notice.value = replacementNotice
    } finally {
      replacing.value = false
    }
  }

  return {
    query,
    replaceText,
    include,
    exclude,
    options,
    results,
    expanded,
    loading,
    replacing,
    engine,
    totalMatches,
    totalFiles,
    truncated,
    error,
    notice,
    preview,
    previewScope,
    hasQuery,
    matchCount,
    setOption,
    startSearch,
    scheduleSearch,
    cancelSearch,
    toggleFile,
    jump,
    requestReplace,
    cancelReplace,
    applyReplace
  }
})
