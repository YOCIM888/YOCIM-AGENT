import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuditApproval, AuditEntry, AuditStats } from '@shared/audit'
import { AUDIT_LIMITS, type AuditFilterInput } from '@shared/ipc'
import { useSessionStore } from './session'

export type AuditScope = 'session' | 'all'
export type AuditResultFilter = '' | 'ok' | 'failed'
export type AuditApprovalFilter = '' | AuditApproval
export type AuditRange = 'all' | 'today' | 'week'

const DAY_MS = 24 * 60 * 60 * 1000

function startOfToday(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

/** 时间范围 → 毫秒下限；null 表示不限 */
function rangeStart(range: AuditRange): number | null {
  if (range === 'today') return startOfToday()
  if (range === 'week') return startOfToday() - 6 * DAY_MS
  return null
}

export const useAuditStore = defineStore('audit', () => {
  const sessions = useSessionStore()

  const entries = ref<AuditEntry[]>([])
  const total = ref(0)
  const stats = ref<AuditStats | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref('')
  const notice = ref('')

  const scope = ref<AuditScope>(sessions.activeSessionId ? 'session' : 'all')
  const tool = ref('')
  const result = ref<AuditResultFilter>('')
  const approval = ref<AuditApprovalFilter>('')
  const keyword = ref('')
  const range = ref<AuditRange>('all')
  const page = ref(1)
  const pageSize = AUDIT_LIMITS.defaultPageSize

  const live = ref(false)
  const detail = ref<AuditEntry | null>(null)

  const tools = computed<string[]>(() => stats.value?.tools ?? [])
  const hasMore = computed(() => entries.value.length < total.value)
  const hasFilters = computed(
    () =>
      Boolean(tool.value || result.value || approval.value || keyword.value.trim()) ||
      range.value !== 'all'
  )

  function buildFilter(): AuditFilterInput {
    const from = rangeStart(range.value)
    const sessionId =
      scope.value === 'session' ? (sessions.activeSessionId ?? undefined) : undefined
    return {
      ...(sessionId ? { sessionId } : {}),
      ...(tool.value ? { tool: tool.value } : {}),
      ...(result.value ? { ok: result.value === 'ok' } : {}),
      ...(approval.value ? { approval: approval.value } : {}),
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      ...(from === null ? {} : { from })
    }
  }

  async function fetchStats(): Promise<void> {
    const response = await window.yocim.audit.stats(buildFilter())
    if (response.ok) {
      stats.value = response.data
    } else {
      error.value = response.error.message
    }
  }

  /** silent：实时刷新时不清空列表、不显示加载态，避免闪烁 */
  async function refresh(options: { silent?: boolean } = {}): Promise<void> {
    if (!options.silent) {
      loading.value = true
      error.value = ''
      notice.value = ''
    }
    try {
      const [pageResult] = await Promise.all([
        window.yocim.audit.query({ ...buildFilter(), page: 1, pageSize }),
        fetchStats()
      ])
      if (!pageResult.ok) {
        error.value = pageResult.error.message
        return
      }
      entries.value = pageResult.data.entries
      total.value = pageResult.data.total
      page.value = 1
    } finally {
      loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const next = page.value + 1
      const response = await window.yocim.audit.query({
        ...buildFilter(),
        page: next,
        pageSize
      })
      if (!response.ok) {
        error.value = response.error.message
        return
      }
      const known = new Set(entries.value.map((entry) => entry.id))
      entries.value = [
        ...entries.value,
        ...response.data.entries.filter((entry) => !known.has(entry.id))
      ]
      total.value = response.data.total
      page.value = next
    } finally {
      loadingMore.value = false
    }
  }

  async function setScope(next: AuditScope): Promise<void> {
    if (next === 'session' && !sessions.activeSessionId) return
    scope.value = next
    await refresh()
  }

  async function setFilter(patch: {
    tool?: string
    result?: AuditResultFilter
    approval?: AuditApprovalFilter
    keyword?: string
    range?: AuditRange
  }): Promise<void> {
    if (patch.tool !== undefined) tool.value = patch.tool
    if (patch.result !== undefined) result.value = patch.result
    if (patch.approval !== undefined) approval.value = patch.approval
    if (patch.keyword !== undefined) keyword.value = patch.keyword
    if (patch.range !== undefined) range.value = patch.range
    await refresh()
  }

  async function clearFilters(): Promise<void> {
    tool.value = ''
    result.value = ''
    approval.value = ''
    keyword.value = ''
    range.value = 'all'
    await refresh()
  }

  async function exportTo(format: 'json' | 'csv'): Promise<void> {
    notice.value = ''
    error.value = ''
    const response = await window.yocim.audit.export({ ...buildFilter(), format })
    if (!response.ok) {
      error.value = response.error.message
      return
    }
    notice.value = response.data.path
      ? `已导出 ${response.data.count} 条到 ${response.data.path}`
      : '已取消导出'
  }

  function openDetail(entry: AuditEntry): void {
    detail.value = entry
  }

  function closeDetail(): void {
    detail.value = null
  }

  function setLive(value: boolean): void {
    live.value = value
    if (value) void refresh({ silent: true })
  }

  function reset(): void {
    entries.value = []
    total.value = 0
    stats.value = null
    page.value = 1
    detail.value = null
    error.value = ''
    notice.value = ''
  }

  return {
    entries,
    total,
    stats,
    loading,
    loadingMore,
    error,
    notice,
    scope,
    tool,
    result,
    approval,
    keyword,
    range,
    page,
    pageSize,
    live,
    detail,
    tools,
    hasMore,
    hasFilters,
    buildFilter,
    refresh,
    loadMore,
    setScope,
    setFilter,
    clearFilters,
    exportTo,
    openDetail,
    closeDetail,
    setLive,
    reset
  }
})
