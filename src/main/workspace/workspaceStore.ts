import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

const FILE_NAME = 'workspace.json'

export class WorkspaceStore {
  private readonly filePath: string

  constructor(filePath: string = path.join(app.getPath('userData'), FILE_NAME)) {
    this.filePath = filePath
  }

  async load(): Promise<string | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { root?: unknown }).root === 'string'
      ) {
        return (parsed as { root: string }).root
      }
      return null
    } catch {
      return null
    }
  }

  async save(root: string | null): Promise<void> {
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await writeFile(this.filePath, JSON.stringify({ root }, null, 2), 'utf8')
    } catch {
      // 持久化失败不影响当前会话使用工作区
    }
  }
}
