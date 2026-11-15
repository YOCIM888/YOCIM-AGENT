import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileClipboard } from '../../src/main/workspace/fileClipboard'
import {
  assertValidEntryName,
  copyWorkspaceEntry,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  moveWorkspaceEntry,
  renameWorkspaceEntry
} from '../../src/main/workspace/fileExplorer'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'

let tempRoot: string
let workspaceRoot: string
let trashDir: string
let guard: WorkspacePathGuard
let trashed: string[]

async function trashItem(absolutePath: string): Promise<void> {
  trashed.push(absolutePath)
  await rename(
    absolutePath,
    path.join(trashDir, `${path.basename(absolutePath)}-${trashed.length}`)
  )
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-explorer-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  trashDir = path.join(tempRoot, 'trash')
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await mkdir(trashDir, { recursive: true })
  await writeFile(path.join(workspaceRoot, 'src', 'a.ts'), 'export const a = 1')
  await writeFile(path.join(workspaceRoot, 'README.md'), '# hi')
  guard = await WorkspacePathGuard.create(workspaceRoot)
  trashed = []
})

afterEach(async () => {
  fileClipboard.clear()
  await rm(tempRoot, { recursive: true, force: true })
})

describe('assertValidEntryName', () => {
  it('rejects empty, reserved and illegal names', () => {
    for (const name of [
      '',
      '   ',
      '.',
      '..',
      'a/b',
      'a\\b',
      'a:b',
      'a*b',
      'a?b',
      'a"b',
      'a<b',
      'a>b',
      'a|b',
      'name.',
      'name '
    ]) {
      expect(() => assertValidEntryName(name)).toThrow()
    }
  })

  it('accepts ordinary names', () => {
    expect(() => assertValidEntryName('新建文件.txt')).not.toThrow()
    expect(() => assertValidEntryName('my-component.vue')).not.toThrow()
  })
})

describe('createWorkspaceEntry', () => {
  it('creates files and folders at root and nested paths', async () => {
    const file = await createWorkspaceEntry(guard, { parentPath: '', name: 'note.txt' }, 'file')
    expect(file).toMatchObject({ name: 'note.txt', relativePath: 'note.txt', type: 'file' })
    expect(await readFile(path.join(workspaceRoot, 'note.txt'), 'utf8')).toBe('')

    const folder = await createWorkspaceEntry(
      guard,
      { parentPath: 'src', name: 'lib' },
      'directory'
    )
    expect(folder).toMatchObject({ name: 'lib', relativePath: 'src/lib', type: 'directory' })
  })

  it('rejects duplicates, illegal names and escaping parents', async () => {
    await expect(
      createWorkspaceEntry(guard, { parentPath: '', name: 'README.md' }, 'file')
    ).rejects.toMatchObject({ code: 'E_EXISTS' })
    await expect(
      createWorkspaceEntry(guard, { parentPath: '', name: 'bad/name' }, 'file')
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' })
    await expect(
      createWorkspaceEntry(guard, { parentPath: '..', name: 'x.txt' }, 'file')
    ).rejects.toMatchObject({ code: 'E_PATH_ESCAPE' })
  })
})

describe('renameWorkspaceEntry', () => {
  it('renames within the same parent', async () => {
    const node = await renameWorkspaceEntry(guard, { relativePath: 'src/a.ts', newName: 'b.ts' })
    expect(node.relativePath).toBe('src/b.ts')
    expect(await readFile(path.join(workspaceRoot, 'src', 'b.ts'), 'utf8')).toBe(
      'export const a = 1'
    )
  })

  it('rejects duplicates and the workspace root', async () => {
    await expect(
      renameWorkspaceEntry(guard, { relativePath: 'README.md', newName: 'src' })
    ).rejects.toMatchObject({ code: 'E_EXISTS' })
    await expect(
      renameWorkspaceEntry(guard, { relativePath: '', newName: 'whatever' })
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' })
  })
})

describe('copyWorkspaceEntry', () => {
  it('copies a file into another directory', async () => {
    const result = await copyWorkspaceEntry(guard, {
      sourcePath: 'README.md',
      targetDir: 'src',
      conflict: 'error'
    })
    expect(result).toEqual({ relativePath: 'src/README.md', skipped: false })
    expect(await readFile(path.join(workspaceRoot, 'src', 'README.md'), 'utf8')).toBe('# hi')
    expect(await readFile(path.join(workspaceRoot, 'README.md'), 'utf8')).toBe('# hi')
  })

  it('resolves conflicts with keep-both, skip, error and replace', async () => {
    const keepBoth = await copyWorkspaceEntry(guard, {
      sourcePath: 'src/a.ts',
      targetDir: 'src',
      conflict: 'keep-both'
    })
    expect(keepBoth.relativePath).toBe('src/a (2).ts')

    const skipped = await copyWorkspaceEntry(guard, {
      sourcePath: 'src/a.ts',
      targetDir: 'src',
      conflict: 'skip'
    })
    expect(skipped.skipped).toBe(true)

    await expect(
      copyWorkspaceEntry(guard, { sourcePath: 'src/a.ts', targetDir: 'src', conflict: 'error' })
    ).rejects.toMatchObject({ code: 'E_EXISTS' })

    await writeFile(path.join(workspaceRoot, 'src', 'a.ts'), 'changed')
    const replaced = await copyWorkspaceEntry(guard, {
      sourcePath: 'README.md',
      targetDir: 'src',
      conflict: 'keep-both'
    })
    expect(replaced.relativePath).toBe('src/README.md')
  })

  it('copies directories recursively and forbids copying into themselves', async () => {
    await mkdir(path.join(workspaceRoot, 'src', 'nested'))
    await writeFile(path.join(workspaceRoot, 'src', 'nested', 'deep.txt'), 'deep')
    const result = await copyWorkspaceEntry(guard, {
      sourcePath: 'src',
      targetDir: '',
      conflict: 'keep-both'
    })
    expect(result.relativePath).toBe('src (2)')
    expect(await readFile(path.join(workspaceRoot, 'src (2)', 'nested', 'deep.txt'), 'utf8')).toBe(
      'deep'
    )

    await expect(
      copyWorkspaceEntry(guard, { sourcePath: 'src', targetDir: 'src', conflict: 'error' })
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' })
  })
})

describe('moveWorkspaceEntry', () => {
  it('moves a file with the rename fast path', async () => {
    const result = await moveWorkspaceEntry(
      guard,
      { sourcePath: 'README.md', targetDir: 'src', conflict: 'error' },
      trashItem
    )
    expect(result.relativePath).toBe('src/README.md')
    expect(trashed).toHaveLength(0)
    await expect(readFile(path.join(workspaceRoot, 'README.md'))).rejects.toThrow()
    expect(await readFile(path.join(workspaceRoot, 'src', 'README.md'), 'utf8')).toBe('# hi')
  })

  it('replaces an existing target by copying then trashing the source', async () => {
    await writeFile(path.join(workspaceRoot, 'src', 'README.md'), 'old')
    const result = await moveWorkspaceEntry(
      guard,
      { sourcePath: 'README.md', targetDir: 'src', conflict: 'replace' },
      trashItem
    )
    expect(result.relativePath).toBe('src/README.md')
    expect(await readFile(path.join(workspaceRoot, 'src', 'README.md'), 'utf8')).toBe('# hi')
    expect(trashed).toEqual([path.join(workspaceRoot, 'README.md')])
  })

  it('forbids moving a directory into its descendant', async () => {
    await expect(
      moveWorkspaceEntry(
        guard,
        { sourcePath: 'src', targetDir: 'src', conflict: 'error' },
        trashItem
      )
    ).rejects.toMatchObject({ code: 'E_INVALID_INPUT' })
  })

  it('treats pasting onto the same location as a no-op', async () => {
    const result = await moveWorkspaceEntry(
      guard,
      { sourcePath: 'README.md', targetDir: '', conflict: 'replace' },
      trashItem
    )
    expect(result).toEqual({ relativePath: 'README.md', skipped: false })
    expect(trashed).toHaveLength(0)
    expect(await readFile(path.join(workspaceRoot, 'README.md'), 'utf8')).toBe('# hi')
  })
})

describe('deleteWorkspaceEntry', () => {
  it('moves entries to the recycle bin instead of permanent deletion', async () => {
    const result = await deleteWorkspaceEntry(guard, 'README.md', trashItem)
    expect(result.deleted).toBe(true)
    expect(trashed).toEqual([path.join(workspaceRoot, 'README.md')])
    await expect(readFile(path.join(workspaceRoot, 'README.md'))).rejects.toThrow()
    const recovered = await readFile(path.join(trashDir, 'README.md-1'), 'utf8')
    expect(recovered).toBe('# hi')
  })

  it('refuses to delete the workspace root', async () => {
    await expect(deleteWorkspaceEntry(guard, '', trashItem)).rejects.toMatchObject({
      code: 'E_INVALID_INPUT'
    })
  })
})

describe('fileClipboard', () => {
  it('stores, exposes and clears the internal clipboard', () => {
    expect(fileClipboard.get()).toBeNull()
    expect(fileClipboard.publicState()).toBeNull()

    fileClipboard.set({ mode: 'cut', relativePath: 'src/a.ts', name: 'a.ts', workspaceRoot, ts: 1 })
    expect(fileClipboard.publicState()).toEqual({
      mode: 'cut',
      relativePath: 'src/a.ts',
      name: 'a.ts'
    })
    expect(fileClipboard.get()?.workspaceRoot).toBe(workspaceRoot)

    fileClipboard.clear()
    expect(fileClipboard.get()).toBeNull()
  })
})
