import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSpawnSpec,
  describeCommand,
  detectPackageManager,
  TaskService
} from '../../src/main/tasks/taskService'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(os.tmpdir(), 'yocim-task-'))
  tempDirs.push(dir)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(dir, relative)
    await mkdir(join(absolute, '..'), { recursive: true })
    await writeFile(absolute, content)
  }
  return dir
}

function service(root: string | null): TaskService {
  return new TaskService({ getRoot: () => root, emit: () => {} })
}

describe('detectPackageManager', () => {
  it('prefers pnpm, then yarn, and falls back to npm', async () => {
    const pnpm = await makeWorkspace({ 'pnpm-lock.yaml': '', 'yarn.lock': '' })
    expect(await detectPackageManager(pnpm)).toBe('pnpm')

    const yarn = await makeWorkspace({ 'yarn.lock': '' })
    expect(await detectPackageManager(yarn)).toBe('yarn')

    const plain = await makeWorkspace({ 'package.json': '{}' })
    expect(await detectPackageManager(plain)).toBe('npm')
  })
})

describe('buildSpawnSpec', () => {
  it('wraps .cmd/.bat through cmd.exe on Windows only', () => {
    const spec = buildSpawnSpec('npm.cmd', ['run', 'build'])
    if (process.platform === 'win32') {
      expect(spec.viaCmd).toBe(true)
      expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
      expect(spec.args[3]).toBe('npm.cmd run build')
    } else {
      expect(spec).toEqual({ command: 'npm.cmd', args: ['run', 'build'], viaCmd: false })
    }
  })

  it('keeps plain executables untouched and quotes arguments with spaces', () => {
    expect(buildSpawnSpec('node', ['-v'])).toEqual({
      command: 'node',
      args: ['-v'],
      viaCmd: false
    })
    if (process.platform === 'win32') {
      const spec = buildSpawnSpec('demo.bat', ['a b'])
      expect(spec.args[3]).toBe('demo.bat "a b"')
    }
  })

  it('renders a readable command line for confirmation', () => {
    expect(describeCommand('node', ['--version'])).toBe('node --version')
    expect(describeCommand('node', ['script with space.js'])).toBe('node "script with space.js"')
  })
})

describe('TaskService.list', () => {
  it('reports a clear error when no workspace is open', async () => {
    const discovery = await service(null).list()
    expect(discovery.tasks).toEqual([])
    expect(discovery.packageManager).toBeNull()
    expect(discovery.error).toContain('未打开工作区')
  })

  it('lists package.json scripts and merges custom tasks', async () => {
    const root = await makeWorkspace({
      'package.json': JSON.stringify({
        scripts: { test: 'vitest', 'build:web': 'vite build', 'bad name': 'x' }
      }),
      '.yocim/tasks.json': JSON.stringify({
        tasks: [
          { label: 'node 版本', command: 'node', args: ['--version'] },
          { label: '越界', command: 'node', args: ['-v'], cwd: '../outside' },
          { label: '', command: 'node' }
        ]
      })
    })

    const discovery = await service(root).list()
    expect(discovery.packageManager).toBe('npm')
    expect(discovery.scriptsFile).toBe('package.json')
    expect(discovery.tasksFile).toBe('.yocim/tasks.json')
    expect(discovery.error).toBeUndefined()

    const npmTasks = discovery.tasks.filter((task) => task.source === 'npm')
    expect(npmTasks.map((task) => task.label)).toEqual(['build:web', 'test'])
    expect(npmTasks[0]?.commandLine).toBe('npm run build:web')

    const custom = discovery.tasks.filter((task) => task.source === 'custom')
    expect(custom).toHaveLength(1)
    expect(custom[0]?.id).toBe('custom:node 版本')
    expect(custom[0]?.commandLine).toBe('node --version')
  })

  it('keeps nested cwd inside the workspace and reports broken JSON', async () => {
    const root = await makeWorkspace({
      '.yocim/tasks.json': '{ "tasks": [ { "label": "x", '
    })
    const broken = await service(root).list()
    expect(broken.error).toContain('不是合法 JSON')
    expect(broken.tasks).toEqual([])

    const nestedRoot = await makeWorkspace({
      '.yocim/tasks.json': JSON.stringify({
        tasks: [{ label: '子目录', command: 'node', args: ['-v'], cwd: 'sub' }]
      }),
      'sub/keep.txt': 'x'
    })
    const nested = await service(nestedRoot).list()
    expect(nested.tasks[0]?.cwd).toBe('sub')
    expect(join(nestedRoot, nested.tasks[0]?.cwd ?? '')).toBe(`${nestedRoot}${sep}sub`)
  })
})
