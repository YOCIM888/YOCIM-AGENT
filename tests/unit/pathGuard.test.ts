import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  isInsideRoot,
  normalizeWorkspaceRelativePath,
  WorkspacePathGuard
} from '../../src/main/workspace/pathGuard'

let tempRoot: string
let workspaceRoot: string
let outsideRoot: string
let guard: WorkspacePathGuard

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-guard-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  outsideRoot = path.join(tempRoot, 'outside')
  await mkdir(workspaceRoot, { recursive: true })
  await mkdir(outsideRoot, { recursive: true })
  await writeFile(path.join(workspaceRoot, 'hello.txt'), 'hello')
  await writeFile(path.join(outsideRoot, 'secret.txt'), 'secret')
  guard = await WorkspacePathGuard.create(workspaceRoot)
})

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

async function expectRejection(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('normalizeWorkspaceRelativePath', () => {
  it('accepts nested relative paths and normalizes separators', () => {
    expect(normalizeWorkspaceRelativePath('src/main/index.ts')).toBe('src/main/index.ts')
    expect(normalizeWorkspaceRelativePath('src\\main\\index.ts')).toBe('src/main/index.ts')
  })

  it('rejects parent directory traversal', () => {
    expect(() => normalizeWorkspaceRelativePath('../secret.txt')).toThrowError(/上级目录/)
    expect(() => normalizeWorkspaceRelativePath('src/../../secret.txt')).toThrowError(/上级目录/)
  })

  it('rejects absolute, drive and UNC paths', () => {
    expect(() => normalizeWorkspaceRelativePath('C:\\Windows\\win.ini')).toThrow()
    expect(() => normalizeWorkspaceRelativePath('/etc/passwd')).toThrow()
    expect(() => normalizeWorkspaceRelativePath('\\\\server\\share\\secret.txt')).toThrow()
  })

  it('rejects null bytes', () => {
    expect(() => normalizeWorkspaceRelativePath('a\0b')).toThrowError(/非法字符/)
  })
})

describe('isInsideRoot', () => {
  it('distinguishes workspace from sibling directories with same prefix', () => {
    expect(isInsideRoot(path.join(tempRoot, 'workspace'), path.join(tempRoot, 'workspace'))).toBe(
      true
    )
    expect(
      isInsideRoot(path.join(tempRoot, 'workspace'), path.join(tempRoot, 'workspace-evil'))
    ).toBe(false)
  })
})

describe('WorkspacePathGuard.resolve', () => {
  it('resolves files inside the workspace', async () => {
    const resolved = await guard.resolve('hello.txt')
    expect(resolved.relativePath).toBe('hello.txt')
    expect(resolved.absolutePath).toBe(path.join(guard.root, 'hello.txt'))
  })

  it('resolves the workspace root for an empty path', async () => {
    const resolved = await guard.resolve('')
    expect(resolved.absolutePath).toBe(guard.root)
    expect(resolved.relativePath).toBe('.')
  })

  it('rejects traversal and absolute paths', async () => {
    await expectRejection(guard.resolve('../outside/secret.txt'), 'E_PATH_ESCAPE')
    await expectRejection(guard.resolve('C:\\Windows\\win.ini'), 'E_PATH_ESCAPE')
    await expectRejection(guard.resolve('/etc/passwd'), 'E_PATH_ESCAPE')
    await expectRejection(guard.resolve('\\\\server\\share\\secret.txt'), 'E_PATH_ESCAPE')
  })

  it('reports missing paths', async () => {
    await expectRejection(guard.resolve('missing.txt'), 'E_NOT_FOUND')
  })

  it('blocks symlinks that point outside the workspace', async (context) => {
    const linkPath = path.join(workspaceRoot, 'escape-link')
    try {
      await symlink(outsideRoot, linkPath, 'junction')
    } catch {
      context.skip()
      return
    }

    await expectRejection(guard.resolve('escape-link/secret.txt'), 'E_PATH_ESCAPE')
    await rm(linkPath, { force: true, recursive: true })
  })

  it('allows symlinks that stay inside the workspace', async (context) => {
    const insideDir = path.join(workspaceRoot, 'inside')
    const linkPath = path.join(workspaceRoot, 'inside-link')
    await mkdir(insideDir, { recursive: true })
    await writeFile(path.join(insideDir, 'note.txt'), 'note')
    try {
      await symlink(insideDir, linkPath, 'junction')
    } catch {
      context.skip()
      return
    }

    const resolved = await guard.resolve('inside-link/note.txt')
    expect(resolved.absolutePath).toBe(path.join(guard.root, 'inside', 'note.txt'))
  })
})
