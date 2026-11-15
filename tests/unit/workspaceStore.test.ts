import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FsTreeNode } from '../../src/shared/ipc'
import { parentOf, useWorkspaceStore } from '../../src/renderer/src/stores/workspace'

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data }
}

const rootNodes: FsTreeNode[] = [
  { name: 'src', relativePath: 'src', type: 'directory' },
  { name: 'a.ts', relativePath: 'a.ts', type: 'file' }
]
const srcChildren: FsTreeNode[] = [{ name: 'b.ts', relativePath: 'src/b.ts', type: 'file' }]

let clip: { mode: 'cut' | 'copy'; relativePath: string; name: string } | null = null

const workspaceApi = {
  tree: vi.fn(async (input: { relativePath: string }) =>
    ok(input.relativePath === 'src' ? srcChildren : rootNodes)
  ),
  readFile: vi.fn(async () =>
    ok({ relativePath: 'a.ts', content: 'x', truncated: false, size: 1 })
  ),
  clipboard: vi.fn(
    async (input: { action: string; mode?: 'cut' | 'copy'; relativePath?: string }) => {
      if (input.action === 'set') {
        clip = { mode: input.mode!, relativePath: input.relativePath!, name: 'a.ts' }
        return ok(clip)
      }
      if (input.action === 'clear') {
        clip = null
        return ok(null)
      }
      return ok(clip)
    }
  ),
  createFile: vi.fn(async () => ok({ name: 'new.ts', relativePath: 'new.ts', type: 'file' })),
  createFolder: vi.fn(async () => ok({ name: 'dir', relativePath: 'dir', type: 'directory' })),
  rename: vi.fn(async () => ok({ name: 'b.ts', relativePath: 'b.ts', type: 'file' })),
  delete: vi.fn(async () => ok({ deleted: true })),
  move: vi.fn(async () => ok({ relativePath: 'src/a.ts', skipped: false })),
  copy: vi.fn(async () => ok({ relativePath: 'src/a.ts', skipped: false })),
  reveal: vi.fn(async () => ok(null))
}
const clipboardApi = { writeText: vi.fn(async () => ok(null)) }

beforeEach(() => {
  vi.clearAllMocks()
  clip = null
  setActivePinia(createPinia())
  ;(globalThis as unknown as { window: unknown }).window = {
    yocim: { workspace: workspaceApi, clipboard: clipboardApi }
  }
})

describe('parentOf', () => {
  it('returns the parent directory using forward slashes', () => {
    expect(parentOf('src/lib/a.ts')).toBe('src/lib')
    expect(parentOf('a.ts')).toBe('')
  })
})

describe('workspace store lazy tree', () => {
  it('loads only the root level on refresh', async () => {
    const store = useWorkspaceStore()
    await store.refreshTree()
    expect(workspaceApi.tree).toHaveBeenCalledWith({ relativePath: '', depth: 1 })
    expect(store.tree.map((n) => n.name)).toEqual(['src', 'a.ts'])
    expect(store.expanded.size).toBe(0)
  })

  it('lazily loads and caches directory children', async () => {
    const store = useWorkspaceStore()
    await store.toggleDir(rootNodes[0])
    expect(store.expanded.has('src')).toBe(true)
    expect(store.childrenOf('src').map((n) => n.name)).toEqual(['b.ts'])
    await store.loadChildren('src')
    const srcCalls = workspaceApi.tree.mock.calls.filter((c) => c[0].relativePath === 'src')
    expect(srcCalls).toHaveLength(1)
  })

  it('collapses all directories', async () => {
    const store = useWorkspaceStore()
    await store.toggleDir(rootNodes[0])
    store.collapseAll()
    expect(store.expanded.size).toBe(0)
  })
})

describe('workspace store clipboard and operations', () => {
  it('routes paste to move for cut and copy for copy', async () => {
    const store = useWorkspaceStore()
    await store.setClipboard('cut', 'a.ts')
    await store.paste('src')
    expect(workspaceApi.move).toHaveBeenCalledWith({
      sourcePath: 'a.ts',
      targetDir: 'src',
      conflict: 'error'
    })
    expect(workspaceApi.copy).not.toHaveBeenCalled()

    await store.setClipboard('copy', 'a.ts')
    await store.paste('src')
    expect(workspaceApi.copy).toHaveBeenCalledWith({
      sourcePath: 'a.ts',
      targetDir: 'src',
      conflict: 'error'
    })
  })

  it('creates files and selects the new entry', async () => {
    const store = useWorkspaceStore()
    const created = await store.createEntry('src', 'new.ts', 'file')
    expect(created).toBe(true)
    expect(workspaceApi.createFile).toHaveBeenCalledWith({ parentPath: 'src', name: 'new.ts' })
    expect(store.selectedPath).toBe('new.ts')
    expect(store.expanded.has('src')).toBe(true)
  })

  it('clears the active file when it is deleted', async () => {
    const store = useWorkspaceStore()
    await store.openFile(rootNodes[1])
    expect(store.activeFile?.relativePath).toBe('a.ts')
    expect(store.isPreview).toBe(true)
    await store.deleteEntry('a.ts')
    expect(store.activeFile).toBeNull()
  })

  it('pins the active file on demand', async () => {
    const store = useWorkspaceStore()
    await store.openFile(rootNodes[1])
    expect(store.isPreview).toBe(true)
    await store.openFile(rootNodes[1], { pin: true })
    expect(store.isPreview).toBe(false)
  })
})
