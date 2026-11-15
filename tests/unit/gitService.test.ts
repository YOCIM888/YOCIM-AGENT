import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { GitService } from '../../src/main/git/gitService'
import { detectGit, runGit } from '../../src/main/git/gitRunner'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'

let hasGit = false
const tempDirs: string[] = []

beforeAll(async () => {
  hasGit = (await detectGit()).available
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeRepo(): Promise<{ dir: string; service: GitService }> {
  const dir = await mkdtemp(join(os.tmpdir(), 'yocim-git-'))
  tempDirs.push(dir)
  const guard = await WorkspacePathGuard.create(dir)
  const service = new GitService({ getGuard: () => guard })
  await service.init()
  await runGit(['config', 'user.email', 'e2e@yocim.test'], { cwd: dir, timeoutMs: 20_000 })
  await runGit(['config', 'user.name', 'YOCIM E2E'], { cwd: dir, timeoutMs: 20_000 })
  await writeFile(join(dir, 'app.ts'), 'export const version = 1\n')
  await service.stage({ paths: ['app.ts'] })
  await service.commit({ message: 'init', all: false })
  return { dir, service }
}

describe('GitService', () => {
  it('detects the repository, branch and untracked files', async (context) => {
    if (!hasGit) return context.skip()
    const { service } = await makeRepo()

    const clean = await service.status()
    expect(clean.available).toBe(true)
    expect(clean.isRepo).toBe(true)
    expect(['main', 'master']).toContain(clean.branch)
    expect(clean.staged).toHaveLength(0)
    expect(clean.message).toBeUndefined()
  })

  it('stages, commits and reports the commit hash', async (context) => {
    if (!hasGit) return context.skip()
    const { dir, service } = await makeRepo()

    await writeFile(join(dir, 'next.ts'), 'export const next = true\n')
    const withUntracked = await service.status()
    expect(withUntracked.untracked.map((change) => change.path)).toContain('next.ts')

    const staged = await service.stage({ paths: ['next.ts'] })
    expect(staged.staged.map((change) => change.path)).toContain('next.ts')
    expect(staged.untracked).toHaveLength(0)

    const committed = await service.commit({ message: 'add next', all: false })
    expect(committed.commit.length).toBeGreaterThanOrEqual(7)
    expect(committed.status.staged).toHaveLength(0)

    const log = await runGit(['log', '-1', '--pretty=%s'], { cwd: dir, timeoutMs: 20_000 })
    expect(log.stdout.trim()).toBe('add next')
  })

  it('unstages files back to the worktree group', async (context) => {
    if (!hasGit) return context.skip()
    const { dir, service } = await makeRepo()

    await writeFile(join(dir, 'app.ts'), 'export const version = 2\n')
    await service.stage({ paths: ['app.ts'] })
    const unstaged = await service.unstage({ paths: ['app.ts'] })
    expect(unstaged.staged).toHaveLength(0)
    expect(unstaged.unstaged.map((change) => change.path)).toContain('app.ts')
  })

  it('builds read-only diffs against the index and HEAD', async (context) => {
    if (!hasGit) return context.skip()
    const { dir, service } = await makeRepo()

    await writeFile(join(dir, 'app.ts'), 'export const version = 2\n')
    const worktreeDiff = await service.diff({ relativePath: 'app.ts', staged: false })
    expect(worktreeDiff.original).toContain('version = 1')
    expect(worktreeDiff.modified).toContain('version = 2')
    expect(worktreeDiff.binary).toBe(false)

    await service.stage({ paths: ['app.ts'] })
    const stagedDiff = await service.diff({ relativePath: 'app.ts', staged: true })
    expect(stagedDiff.original).toContain('version = 1')
    expect(stagedDiff.modified).toContain('version = 2')
  })

  it('reports renamed files with their original path', async (context) => {
    if (!hasGit) return context.skip()
    const { dir, service } = await makeRepo()

    await runGit(['mv', 'app.ts', 'main.ts'], { cwd: dir, timeoutMs: 20_000 })
    const status = await service.status()
    const renamed = status.staged.find((change) => change.path === 'main.ts')
    expect(renamed?.originalPath).toBe('app.ts')
    expect(renamed?.indexStatus).toBe('R')
  })

  it('discards worktree changes but refuses untracked files', async (context) => {
    if (!hasGit) return context.skip()
    const { dir, service } = await makeRepo()

    await writeFile(join(dir, 'app.ts'), 'broken\n')
    const afterDiscard = await service.discard({ paths: ['app.ts'] })
    expect(afterDiscard.unstaged).toHaveLength(0)
    expect(await readFile(join(dir, 'app.ts'), 'utf8')).toContain('version = 1')

    await writeFile(join(dir, 'scratch.txt'), 'temp\n')
    await expect(service.discard({ paths: ['scratch.txt'] })).rejects.toThrow(/未跟踪文件/)
  })

  it('creates and switches branches with name validation', async (context) => {
    if (!hasGit) return context.skip()
    const { dir, service } = await makeRepo()

    const created = await service.checkout({ branch: 'feature/audit', create: true })
    expect(created.branch).toBe('feature/audit')
    const branches = await service.branches()
    expect(branches.local).toContain('feature/audit')
    expect(branches.current).toBe('feature/audit')

    await expect(service.checkout({ branch: 'bad name', create: true })).rejects.toThrow(/非法字符/)
    await expect(service.checkout({ branch: '../escape', create: true })).rejects.toThrow(
      /非法字符/
    )

    const original = branches.local.find((name) => name !== 'feature/audit')
    expect(original).toBeTruthy()
    if (original) {
      const switched = await service.checkout({ branch: original, create: false })
      expect(switched.branch).toBe(original)
    }
    expect(await readFile(join(dir, 'app.ts'), 'utf8')).toContain('version = 1')
  })

  it('only fast-forwards on pull, never forces pushes and publishes with upstream', async (context) => {
    if (!hasGit) return context.skip()
    const dir = await mkdtemp(join(os.tmpdir(), 'yocim-git-args-'))
    tempDirs.push(dir)
    const guard = await WorkspacePathGuard.create(dir)
    const calls: string[][] = []
    const service = new GitService({
      getGuard: () => guard,
      runGit: (args) => {
        calls.push(args)
        if (args.includes('status')) {
          return Promise.resolve({
            code: 0,
            stdout: [
              '# branch.head main',
              '# branch.upstream origin/main',
              '# branch.ab +0 -0'
            ].join('\n'),
            stderr: ''
          })
        }
        if (args.includes('branch')) {
          return Promise.resolve({ code: 0, stdout: 'main\n', stderr: '' })
        }
        if (args.includes('remote')) {
          return Promise.resolve({ code: 0, stdout: 'origin\n', stderr: '' })
        }
        if (args.includes('rev-parse')) {
          return Promise.resolve({ code: 0, stdout: 'main\n', stderr: '' })
        }
        return Promise.resolve({ code: 0, stdout: 'ok\n', stderr: '' })
      }
    })

    await service.pull()
    expect(calls.some((args) => args[0] === 'pull' && args.includes('--ff-only'))).toBe(true)

    await service.push()
    expect(calls.some((args) => args[0] === 'push')).toBe(true)
    expect(calls.every((args) => !args.includes('--force') && !args.includes('-f'))).toBe(true)

    await service.publish()
    expect(calls.some((args) => args.join(' ') === 'push -u origin main')).toBe(true)
    expect(calls.every((args) => !args.includes('--no-verify'))).toBe(true)
  })

  it('maps git failures into readable messages', async (context) => {
    if (!hasGit) return context.skip()
    const dir = await mkdtemp(join(os.tmpdir(), 'yocim-git-norepo-'))
    tempDirs.push(dir)
    const guard = await WorkspacePathGuard.create(dir)
    const service = new GitService({ getGuard: () => guard })

    const status = await service.status()
    expect(status.isRepo).toBe(false)
    expect(status.message).toContain('不是 Git 仓库')

    const initialized = await service.init()
    expect(initialized.isRepo).toBe(true)
  })

  it('records mutating commands in the output log with redaction', async (context) => {
    if (!hasGit) return context.skip()
    const { dir, service } = await makeRepo()

    await writeFile(join(dir, 'app.ts'), 'export const version = 3\n')
    await service.stage({ paths: ['app.ts'] })
    const log = service.outputLog()
    expect(log.some((entry) => entry.command.startsWith('git add'))).toBe(true)
    expect(log.every((entry) => !entry.command.includes('status'))).toBe(true)
  })
})
