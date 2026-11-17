import {
  BROWSER_STORAGE_TYPES,
  isYocimPartitionName,
  type BrowserResetResult,
  type BrowserStorageType
} from '../../shared/browser'

/** Electron Session 的最小子集，便于在单测里替换 */
export interface BrowserStorageSession {
  clearStorageData(options: { storages: BrowserStorageType[] }): Promise<void>
  clearCache(): Promise<void>
}

export interface BrowserDataServiceDeps {
  /** 取隔离 profile 的 session；默认 session 不应传入 */
  getSession: (name: string) => BrowserStorageSession | null
  /** 扫描磁盘上已有的 profile 目录名 */
  listPartitions: () => Promise<string[]>
  /** 删除单个 profile 目录 */
  removePartition: (name: string) => Promise<void>
  /** 清空 append-only 浏览器审计文件 */
  clearAuditFile: () => Promise<void>
  /** 关闭所有活跃的浏览器视图 */
  disposeAll: () => void
  /** 活跃上下文使用的 profile 名（不含 persist: 前缀） */
  activePartitions: () => string[]
}

/**
 * 合并磁盘扫描结果与活跃上下文：只保留本应用的独立 profile。
 * 默认 session（复用日常登录态）永远不在清理范围内。
 */
export function collectBrowserPartitions(
  scanned: readonly string[],
  active: readonly string[]
): string[] {
  const names = new Set<string>()
  for (const raw of [...scanned, ...active]) {
    const name = raw.replace(/^persist:/, '')
    if (isYocimPartitionName(name)) names.add(name)
  }
  return [...names].sort()
}

/** 设置 → 浏览器：清除数据并重置浏览器运行时 */
export class BrowserDataService {
  constructor(private readonly deps: BrowserDataServiceDeps) {}

  async reset(): Promise<BrowserResetResult> {
    // disposeAll 会移除上下文，必须在此之前收集活跃分区
    const active = this.deps.activePartitions()
    this.deps.disposeAll()

    const scanned = await this.deps.listPartitions().catch(() => [])
    const names = collectBrowserPartitions(scanned, active)
    let cleared = 0
    for (const name of names) {
      let ok = false
      try {
        const session = this.deps.getSession(name)
        if (session) {
          await session.clearStorageData({ storages: [...BROWSER_STORAGE_TYPES] })
          await session.clearCache()
          ok = true
        }
      } catch {
        // 会话清理失败仍继续尝试删除磁盘目录
      }
      try {
        await this.deps.removePartition(name)
        ok = true
      } catch {
        // 目录可能已被释放或本就不存在
      }
      if (ok) cleared += 1
    }
    await this.deps.clearAuditFile().catch(() => undefined)
    return { cleared }
  }
}
