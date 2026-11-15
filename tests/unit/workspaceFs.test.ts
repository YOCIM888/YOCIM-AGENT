import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'
import { readWorkspaceFile, readWorkspaceTree } from '../../src/main/workspace/workspaceFs'
import { FS_LIMITS } from '../../src/shared/ipc'

let tempRoot: string
let workspaceRoot: string
let guard: WorkspacePathGuard

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-fs-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(path.join(workspaceRoot, '.git'), { recursive: true })
  await writeFile(path.join(workspaceRoot, 'README.md'), '# YOCIM')
  await writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'export const ok = true')
  await writeFile(path.join(workspaceRoot, 'node_modules', 'pkg', 'index.js'), '// ignored')
  await writeFile(path.join(workspaceRoot, '.git', 'config'), '[core]')
  await writeFile(path.join(workspaceRoot, 'binary.dat'), Buffer.from([1, 0, 2, 3]))
  await writeFile(path.join(workspaceRoot, 'large.txt'), 'a'.repeat(FS_LIMITS.maxFileBytes + 10))
  guard = await WorkspacePathGuard.create(workspaceRoot)
})

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('readWorkspaceTree', () => {
  it('lists entries with directories first and ignores noise directories', async () => {
    const nodes = await readWorkspaceTree(guard, { relativePath: '', depth: 2 })
    const names = nodes.map((node) => node.name)
    expect(names).toContain('src')
    expect(names).toContain('README.md')
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.git')
    expect(names.indexOf('src')).toBeLessThan(names.indexOf('README.md'))
  })

  it('stops at the requested depth', async () => {
    const shallow = await readWorkspaceTree(guard, { relativePath: '', depth: 1 })
    const src = shallow.find((node) => node.name === 'src')
    expect(src?.children).toBeUndefined()

    const deeper = await readWorkspaceTree(guard, { relativePath: '', depth: 2 })
    const srcDeeper = deeper.find((node) => node.name === 'src')
    expect(srcDeeper?.children?.map((node) => node.name)).toEqual(['index.ts'])
  })

  it('rejects escaping paths', async () => {
    await expect(readWorkspaceTree(guard, { relativePath: '..', depth: 1 })).rejects.toMatchObject({
      code: 'E_PATH_ESCAPE'
    })
  })
})

describe('readWorkspaceFile', () => {
  it('reads text files inside the workspace', async () => {
    const result = await readWorkspaceFile(guard, { relativePath: 'README.md' })
    expect(result.content).toBe('# YOCIM')
    expect(result.truncated).toBe(false)
    expect(result.relativePath).toBe(path.join('README.md'))
  })

  it('truncates large files at the configured limit', async () => {
    const result = await readWorkspaceFile(guard, { relativePath: 'large.txt' })
    expect(result.truncated).toBe(true)
    expect(result.size).toBe(FS_LIMITS.maxFileBytes + 10)
    expect(result.content.length).toBe(FS_LIMITS.maxFileBytes)
  })

  it('rejects binary files', async () => {
    await expect(readWorkspaceFile(guard, { relativePath: 'binary.dat' })).rejects.toMatchObject({
      code: 'E_UNSUPPORTED'
    })
  })

  it('rejects directories', async () => {
    await expect(readWorkspaceFile(guard, { relativePath: 'src' })).rejects.toMatchObject({
      code: 'E_INVALID_INPUT'
    })
  })

  it('rejects missing and escaping paths', async () => {
    await expect(readWorkspaceFile(guard, { relativePath: 'missing.txt' })).rejects.toMatchObject({
      code: 'E_NOT_FOUND'
    })
    await expect(
      readWorkspaceFile(guard, { relativePath: '../outside.txt' })
    ).rejects.toMatchObject({ code: 'E_PATH_ESCAPE' })
  })
})
