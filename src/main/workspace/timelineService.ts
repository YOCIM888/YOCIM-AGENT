import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AppError } from '../../shared/errors'
import { FS_LIMITS } from '../../shared/ipc'
import type {
  TimelineEntry,
  TimelineReadResult,
  TimelineRestoreResult,
  TimelineSource
} from '../../shared/ipc'
import type { FileHistoryRecord, FileHistoryRepository } from '../db/repositories'
import type { WorkspacePathGuard } from '../workspace/pathGuard'

export const TIMELINE_LIMITS = {
  maxEntries: 50,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxSnapshotBytes: FS_LIMITS.maxFileBytes
} as const

export interface TimelineDeps {
  history: FileHistoryRepository
  baseDir: string
  now?: () => number
}

export interface SnapshotInput {
  workspaceRoot: string
  relativePath: string
  source: TimelineSource
  content: string
}

function toEntry(record: FileHistoryRecord): TimelineEntry {
  return {
    id: record.id,
    relativePath: record.relativePath,
    source: record.source,
    size: record.size,
    contentHash: record.contentHash,
    createdAt: record.createdAt
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class TimelineService {
  constructor(private readonly deps: TimelineDeps) {}

  private storagePath(workspaceRoot: string, relativePath: string, id: string): string {
    const workspaceHash = hash(workspaceRoot).slice(0, 16)
    const pathHash = hash(relativePath).slice(0, 16)
    return join(this.deps.baseDir, workspaceHash, pathHash, `${id}.txt`)
  }

  async snapshot(input: SnapshotInput): Promise<TimelineEntry | null> {
    if (input.content.includes('\0')) return null
    const size = Buffer.byteLength(input.content, 'utf8')
    if (size > TIMELINE_LIMITS.maxSnapshotBytes) return null

    const contentHash = hash(input.content)
    const latest = this.deps.history.latest(input.workspaceRoot, input.relativePath)
    if (latest && latest.contentHash === contentHash) return null

    const id = randomUUID()
    const storagePath = this.storagePath(input.workspaceRoot, input.relativePath, id)
    await mkdir(dirname(storagePath), { recursive: true })
    await writeFile(storagePath, input.content, 'utf8')

    const createdAt = this.deps.now?.() ?? Date.now()
    const record: FileHistoryRecord = {
      id,
      workspaceRoot: input.workspaceRoot,
      relativePath: input.relativePath,
      source: input.source,
      size,
      contentHash,
      storagePath,
      createdAt
    }
    this.deps.history.insert(record)

    const removed = this.deps.history.prune(
      input.workspaceRoot,
      input.relativePath,
      TIMELINE_LIMITS.maxEntries,
      createdAt - TIMELINE_LIMITS.maxAgeMs
    )
    for (const row of removed) {
      await unlink(row.storagePath).catch(() => undefined)
    }
    return toEntry(record)
  }

  list(workspaceRoot: string, relativePath: string): TimelineEntry[] {
    return this.deps.history
      .list(workspaceRoot, relativePath, TIMELINE_LIMITS.maxEntries)
      .map(toEntry)
  }

  async read(id: string): Promise<TimelineReadResult> {
    const record = this.deps.history.get(id)
    if (!record) {
      throw new AppError('E_NOT_FOUND', '快照不存在')
    }
    let content: string
    try {
      content = await readFile(record.storagePath, 'utf8')
    } catch {
      throw new AppError('E_NOT_FOUND', '快照文件已丢失')
    }
    return { entry: toEntry(record), content }
  }

  async restore(id: string, guard: WorkspacePathGuard): Promise<TimelineRestoreResult> {
    const record = this.deps.history.get(id)
    if (!record) {
      throw new AppError('E_NOT_FOUND', '快照不存在')
    }
    if (record.workspaceRoot !== guard.root) {
      throw new AppError('E_INVALID_INPUT', '快照不属于当前工作区')
    }
    let content: string
    try {
      content = await readFile(record.storagePath, 'utf8')
    } catch {
      throw new AppError('E_NOT_FOUND', '快照文件已丢失')
    }
    const target = await guard.resolveForCreate(record.relativePath)
    await mkdir(dirname(target.absolutePath), { recursive: true })
    await writeFile(target.absolutePath, content, 'utf8')
    await this.snapshot({
      workspaceRoot: guard.root,
      relativePath: target.relativePath,
      source: 'user',
      content
    })
    return {
      relativePath: target.relativePath,
      content,
      size: Buffer.byteLength(content, 'utf8')
    }
  }
}
