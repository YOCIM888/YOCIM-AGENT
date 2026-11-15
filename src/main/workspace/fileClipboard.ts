import type { FsClipboardState } from '../../shared/ipc'

export interface InternalClipboard extends FsClipboardState {
  workspaceRoot: string
  ts: number
}

let current: InternalClipboard | null = null

export const fileClipboard = {
  set(state: InternalClipboard): void {
    current = state
  },
  get(): InternalClipboard | null {
    return current
  },
  clear(): void {
    current = null
  },
  publicState(): FsClipboardState | null {
    if (!current) return null
    return { mode: current.mode, relativePath: current.relativePath, name: current.name }
  }
}
