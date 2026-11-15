import { randomUUID } from 'node:crypto'
import type { AuditEntry, AuditFilter, AuditPage, AuditStats } from '../../shared/audit'
import type { AuditRepository } from '../db/repositories'

export interface AuditStoreOptions {
  maxEntries?: number
  repo?: AuditRepository
}

function matchesFilter(entry: AuditEntry, filter: AuditFilter): boolean {
  if (filter.sessionId && entry.sessionId !== filter.sessionId) return false
  if (filter.tool && entry.tool !== filter.tool) return false
  if (typeof filter.ok === 'boolean' && entry.ok !== filter.ok) return false
  if (filter.approval && entry.approval !== filter.approval) return false
  if (typeof filter.from === 'number' && entry.ts < filter.from) return false
  if (typeof filter.to === 'number' && entry.ts > filter.to) return false
  if (filter.keyword) {
    const keyword = filter.keyword.toLowerCase()
    const haystack = `${entry.tool} ${entry.argsSummary} ${entry.resultSummary}`.toLowerCase()
    if (!haystack.includes(keyword)) return false
  }
  return true
}

export class AuditStore {
  private readonly entries: AuditEntry[] = []
  private readonly maxEntries: number
  private readonly repo: AuditRepository | undefined

  constructor(options: AuditStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 500
    this.repo = options.repo
  }

  record(entry: Omit<AuditEntry, 'id' | 'ts'>): AuditEntry {
    const record: AuditEntry = { id: randomUUID(), ts: Date.now(), ...entry }
    if (this.repo) {
      this.repo.insert(record)
    } else {
      this.entries.unshift(record)
      if (this.entries.length > this.maxEntries) {
        this.entries.length = this.maxEntries
      }
    }
    return record
  }

  list(options: { sessionId?: string; limit?: number } = {}): AuditEntry[] {
    return this.query({ sessionId: options.sessionId }, 1, options.limit ?? 50).entries
  }

  query(filter: AuditFilter, page = 1, pageSize = 50): AuditPage {
    if (this.repo) return this.repo.query(filter, page, pageSize)
    const filtered = this.entries.filter((entry) => matchesFilter(entry, filter))
    const offset = Math.max(0, (page - 1) * pageSize)
    return {
      entries: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      page,
      pageSize
    }
  }

  stats(filter: AuditFilter): AuditStats {
    if (this.repo) return this.repo.stats(filter)
    const filtered = this.entries.filter((entry) => matchesFilter(entry, filter))
    const count = (predicate: (entry: AuditEntry) => boolean): number =>
      filtered.filter(predicate).length
    const timestamps = filtered.map((entry) => entry.ts)
    // 工具下拉不应用 tool 条件，否则选中后只剩一个选项
    const toolSource = this.entries.filter((entry) =>
      matchesFilter(entry, { ...filter, tool: undefined })
    )
    return {
      total: filtered.length,
      ok: count((entry) => entry.ok),
      failed: count((entry) => !entry.ok),
      approved: count((entry) => entry.approval === 'approved'),
      denied: count((entry) => entry.approval === 'denied'),
      notRequired: count((entry) => entry.approval === 'not_required'),
      firstTs: timestamps.length ? Math.min(...timestamps) : null,
      lastTs: timestamps.length ? Math.max(...timestamps) : null,
      tools: [...new Set(toolSource.map((entry) => entry.tool))].sort()
    }
  }

  all(filter: AuditFilter, limit: number): AuditEntry[] {
    if (this.repo) return this.repo.all(filter, limit)
    return this.entries.filter((entry) => matchesFilter(entry, filter)).slice(0, limit)
  }
}
