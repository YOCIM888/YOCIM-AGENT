import path from 'node:path'
import { dialog } from 'electron'
import { AppError } from '../../shared/errors'
import type { WorkspaceInfo } from '../../shared/ipc'
import { fileClipboard } from './fileClipboard'
import { RemotePathGuard, WorkspacePathGuard, type WorkspaceGuardLike } from './pathGuard'
import { WorkspaceStore } from './workspaceStore'

interface ActiveWorkspace {
  info: WorkspaceInfo
  /** SSH 远程工作区没有本地路径，文件操作走 SFTP，此时为 null */
  guard: WorkspacePathGuard | null
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
  fileClipboard.clear()
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

  /**
   * 打开远程工作区。
   * - WSL：根是 UNC 路径，仍然建立本地路径守卫（编辑器/文件树复用本地实现）；
   * - SSH：根是 `ssh://...` 标识，不建立守卫，文件操作由 remoteFs 走 SFTP。
   * 远程工作区不写入 workspace.json，重启后不会留下打不开的根。
   */
  async openRemote(info: WorkspaceInfo): Promise<WorkspaceInfo> {
    const remote = info.remote
    if (!remote) throw new AppError('E_INVALID_INPUT', '缺少远程工作区信息')
    let guard: WorkspacePathGuard | null = null
    if (remote.kind === 'wsl') {
      try {
        guard = await WorkspacePathGuard.create(info.root)
      } catch {
        throw new AppError('E_NOT_FOUND', 'WSL 工作区路径无法访问，请确认发行版已启动')
      }
    }
    active = { info, guard }
    fileClipboard.clear()
    return info
  },

  current(): WorkspaceInfo | null {
    return active?.info ?? null
  },

  currentRemote(): WorkspaceInfo['remote'] | null {
    return active?.info.remote ?? null
  },

  requireGuard(): WorkspacePathGuard {
    if (!active) {
      throw new AppError('E_NO_WORKSPACE', '尚未选择工作区')
    }
    if (!active.guard) {
      throw new AppError('E_UNSUPPORTED', '远程工作区不支持本地文件操作')
    }
    return active.guard
  },

  guardOrNull(): WorkspacePathGuard | null {
    return active?.guard ?? null
  },

  /**
   * Git / 搜索使用的根：本地与 WSL 返回真实守卫，SSH 返回虚拟守卫
   * （只做相对路径规范化，实际命令经 remote exec 在远端执行）。
   */
  accessGuard(): WorkspaceGuardLike {
    if (!active) throw new AppError('E_NO_WORKSPACE', '尚未选择工作区')
    if (active.guard) return active.guard
    return new RemotePathGuard(active.info.remote?.targetId ?? 'remote')
  }
}
