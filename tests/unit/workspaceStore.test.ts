import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FsTreeNode, FsWriteFileResult, IpcResult } from '../../src/shared/ipc'
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
const storage = new Map<string, string>()

interface WriteInput {
  relativePath: string
  content: string
  targetPath?: string
}

const workspaceApi = {
  tree: vi.fn(async (input: { relativePath: string }) =>
    ok(input.relativePath === 'src' ? srcChildren : rootNodes)
  ),
  readFile: vi.fn(async (input: { relativePath: string }) =>
    ok({
      relativePath: input.relativePath,
      content: 'x',
      truncated: false,
      size: 1,
      contentHash: 'hash-x',
      eol: 'lf',
      kind: 'text'
    })
  ),
  current: vi.fn(async () => ok({ root: 'E:/ws', name: 'ws' })),
  writeFile: vi.fn(async (input: WriteInput): Promise<IpcResult<FsWriteFileResult>> =>
    ok({
      status: 'saved' as const,
      relativePath: input.targetPath ?? input.relativePath,
      version: {
        content: input.content,
        contentHash: 'saved-hash',
        eol: 'lf' as const,
        size: input.content.length
      }
    })
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
  rename: vi.fn(async (input: { newName: string }) =>
    ok({ name: input.newName, relativePath: input.newName, type: 'file' })
  ),
  delete: vi.fn(async () => ok({ deleted: true })),
  move: vi.fn(async () => ok({ relativePath: 'src/a.ts', skipped: false })),
  copy: vi.fn(async () => ok({ relativePath: 'src/a.ts', skipped: false })),
  reveal: vi.fn(async () => ok(null))
}
const clipboardApi = { writeText: vi.fn(async () => ok(null)) }

beforeEach(() => {
  vi.clearAllMocks()
  clip = null
  storage.clear()
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0
  } as unknown as Storage
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

const otherNode: FsTreeNode = { name: 'b.ts', relativePath: 'b.ts', type: 'file' }

describe('workspace store P2 editor tabs', () => {
  it('replaces a preview tab and keeps pinned tabs open', async () => {
    const store = useWorkspaceStore()
    await store.openFile(rootNodes[1])
    await store.openFile(otherNode)
    expect(store.tabs).toHaveLength(1)
    expect(store.activeTab?.relativePath).toBe('b.ts')
    expect(store.isPreview).toBe(true)

    await store.openFile(otherNode, { pin: true })
    expect(store.isPreview).toBe(false)
    await store.openFile(rootNodes[1])
    expect(store.tabs).toHaveLength(2)
    expect(store.tabs.map((tab) => tab.relativePath)).toEqual(['b.ts', 'a.ts'])
  })

  it('tracks dirty state, saves content and clears the dirty flag', async () => {
    const store = useWorkspaceStore()
    await store.openFile(rootNodes[1])
    const tab = store.tabs[0]
    store.updateContent(tab.id, 'changed text')
    expect(store.isDirty).toBe(true)
    const result = await store.saveActiveFile()
    expect(workspaceApi.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'a.ts', content: 'changed text' })
    )
    expect(result?.status).toBe('saved')
    expect(store.isDirty).toBe(false)
    expect(store.activeTab?.contentHash).toBe('saved-hash')
  })

  it('exposes the disk version when saving conflicts and can reload from disk', async () => {
    const store = useWorkspaceStore()
    await store.openFile(rootNodes[1])
    workspaceApi.writeFile.mockResolvedValueOnce(
      ok({
        status: 'conflict',
        relativePath: 'a.ts',
        disk: { content: 'external', contentHash: 'disk-hash', eol: 'lf', size: 9 }
      })
    )
    const result = await store.saveActiveFile()
    expect(result?.status).toBe('conflict')
    expect(store.activeTab?.disk?.content).toBe('external')
    await store.resolveConflictWithDisk()
    expect(store.activeTab?.disk).toBeNull()
  })

  it('renames tabs, closes tabs and persists tab paths', async () => {
    const store = useWorkspaceStore()
    await store.openFile(rootNodes[1])
    await store.renameEntry('a.ts', 'renamed.ts')
    expect(store.tabs[0].relativePath).toBe('renamed.ts')
    const stored = JSON.parse(localStorage.getItem('yocim.ui.editorTabs') ?? '{}') as {
      paths: string[]
    }
    expect(stored.paths).toEqual(['renamed.ts'])
    store.closeTab(store.tabs[0].id)
    expect(store.tabs).toHaveLength(0)
    await store.openFile(otherNode)
    store.closeAllTabs()
    expect(store.activeTab).toBeNull()
  })

  it('restores previously opened tabs for the same workspace', async () => {
    const store = useWorkspaceStore()
    await store.openFile(rootNodes[1])
    await store.openFile(otherNode, { pin: true })
    store.pinActiveFile()
    const before = store.tabs.map((tab) => tab.relativePath)
    await store.restore()
    expect(store.tabs.map((tab) => tab.relativePath).sort()).toEqual([...before].sort())
  })
})
