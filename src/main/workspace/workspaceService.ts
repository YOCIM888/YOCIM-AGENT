import path from 'node:path'
import { dialog } from 'electron'
import { AppError } from '../../shared/errors'
import type { WorkspaceInfo } from '../../shared/ipc'
import { WorkspacePathGuard } from './pathGuard'
import { WorkspaceStore } from './workspaceStore'

interface ActiveWorkspace {
  info: WorkspaceInfo
  guard: WorkspacePathGuard
}

let active: ActiveWorkspace | null = null
let store: WorkspaceStore | null = null

function getStore(): WorkspaceStore {
  store ??= new WorkspaceStore()
  return store
}

async function activate(root: string): Promise<WorkspaceInfo> {
  const guard = await WorkspacePathGuard.create(root)
  const name = path.basename(guard.root) || guard.root
  active = { info: { root: guard.root, name }, guard }
  await getStore().save(guard.root)
  return active.info
}

export const workspaceService = {
  async restore(): Promise<WorkspaceInfo | null> {
    const root = await getStore().load()
    if (!root) return null
    try {
      return await activate(root)
    } catch {
      await getStore().save(null)
      return null
    }
  },

  async select(): Promise<WorkspaceInfo | null> {
    const result = await dialog.showOpenDialog({
      title: '选择工作区',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return activate(result.filePaths[0])
  },

  async openRoot(root: string): Promise<WorkspaceInfo> {
    try {
      return await activate(root)
    } catch {
      throw new AppError('E_NOT_FOUND', '项目目录不存在或无法访问')
    }
  },

  current(): WorkspaceInfo | null {
    return active?.info ?? null
  },

  requireGuard(): WorkspacePathGuard {
    if (!active) {
      throw new AppError('E_NO_WORKSPACE', '尚未选择工作区')
    }
    return active.guard
  }
}
