import { randomUUID } from 'node:crypto'
import type { AuditEntry } from '../../shared/audit'
import type { AuditRepository } from '../db/repositories'

export interface AuditStoreOptions {
  maxEntries?: number
  repo?: AuditRepository
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
    if (this.repo) return this.repo.list(options)
    const filtered = options.sessionId
      ? this.entries.filter((entry) => entry.sessionId === options.sessionId)
      : this.entries
    return filtered.slice(0, options.limit ?? 50)
  }
}
