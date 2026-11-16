import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StorageInfo } from '../../shared/billing'

/** 引导文件：放在系统默认目录里，永远不随数据目录迁移而丢失 */
const BOOTSTRAP_RELATIVE = join('boot', 'storage.json')

interface StorageBootstrap {
  /** 自定义数据目录；空表示使用系统默认 */
  dataDir: string
}

/** 统计目录大小时的上限，避免在超大目录上卡住 UI */
const SIZE_WALK_MAX_FILES = 4000
const SIZE_WALK_MAX_DEPTH = 4

function readBootstrap(userDataDir: string): StorageBootstrap {
  try {
    const raw = readFileSync(join(userDataDir, BOOTSTRAP_RELATIVE), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StorageBootstrap>
    const dataDir = typeof parsed.dataDir === 'string' ? parsed.dataDir.trim() : ''
    return { dataDir: dataDir.replace(/[\\/]+$/, '') }
  } catch {
    return { dataDir: '' }
  }
}

function writeBootstrap(userDataDir: string, dataDir: string): void {
  const file = join(userDataDir, BOOTSTRAP_RELATIVE)
  mkdirSync(join(userDataDir, 'boot'), { recursive: true })
  writeFileSync(file, JSON.stringify({ dataDir }, null, 2), 'utf8')
}

/**
 * 解析实际生效的数据目录：
 * 引导文件里指定了就用它，否则用系统默认目录。
 */
export function resolveDataDir(userDataDir: string): string {
  const bootstrap = readBootstrap(userDataDir)
  if (!bootstrap.dataDir) return userDataDir
  try {
    mkdirSync(bootstrap.dataDir, { recursive: true })
    return bootstrap.dataDir
  } catch {
    // 自定义目录不可写时退回默认目录，避免应用起不来
    return userDataDir
  }
}

function dirSize(target: string, depth = 0, budget = { files: SIZE_WALK_MAX_FILES }): number {
  if (depth > SIZE_WALK_MAX_DEPTH || budget.files <= 0) return 0
  let total = 0
  let entries: string[]
  try {
    entries = readdirSync(target)
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (budget.files <= 0) break
    const full = join(target, entry)
    let info: ReturnType<typeof statSync>
    try {
      info = statSync(full)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      total += dirSize(full, depth + 1, budget)
    } else if (info.isFile()) {
      total += info.size
      budget.files -= 1
    }
  }
  return total
}

/**
 * 存储服务：管理数据目录（数据库、日志、时间线快照、扩展）。
 *
 * 数据目录一旦改动需要重启才能生效——数据库文件句柄在运行期不能换。
 */
export class StorageService {
  constructor(
    /** 系统默认目录（Electron userData） */
    private readonly defaultDir: string,
    /** 当前实际生效的目录 */
    private readonly dataDir: string
  ) {}

  /** 写入引导文件：下次启动时生效 */
  persistDataDir(dataDir: string): void {
    const normalized = dataDir.trim().replace(/[\\/]+$/, '')
    writeBootstrap(this.defaultDir, normalized)
  }

  /** 引导文件里记录的目标目录（可能与当前生效目录不同） */
  getPendingDataDir(): string {
    return readBootstrap(this.defaultDir).dataDir
  }

  getInfo(): StorageInfo {
    const pending = this.getPendingDataDir()
    const customized = this.dataDir !== this.defaultDir
    const databasePath = join(this.dataDir, 'yocim.db')
    let databaseBytes = 0
    try {
      databaseBytes = statSync(databasePath).size
    } catch {
      // 数据库文件还不存在时按 0 计
    }
    const entries: Array<{ name: string; bytes: number }> = []
    for (const name of ['logs', 'timeline', 'extensions']) {
      const full = join(this.dataDir, name)
      if (!existsSync(full)) continue
      entries.push({ name, bytes: dirSize(full) })
    }
    return {
      dataDir: this.dataDir,
      defaultDir: this.defaultDir,
      customized,
      pendingRestart: Boolean(pending) && pending !== this.dataDir,
      databaseBytes,
      entries
    }
  }
}
