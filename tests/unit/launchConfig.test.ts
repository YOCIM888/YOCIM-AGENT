import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildLaunchPlan,
  configFromPackageMain,
  normalizeLaunchConfig,
  readLaunchConfigs,
  resolveDebugVariables
} from '../../src/main/debug/launchConfig'
import type { DebugConfig } from '../../src/shared/debug'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(os.tmpdir(), 'yocim-launch-'))
  tempDirs.push(dir)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(dir, relative)
    await mkdir(join(absolute, '..'), { recursive: true })
    await writeFile(absolute, content)
  }
  return dir
}

describe('resolveDebugVariables', () => {
  it('expands workspace variables and env values', () => {
    process.env['YOCIM_TEST_ENV'] = 'from-env'
    const root = join(os.tmpdir(), 'demo-workspace')
    const context = { workspaceRoot: root, activeFile: join(root, 'src', 'main.js') }

    expect(resolveDebugVariables('${workspaceFolder}/a.js', context)).toBe(`${root}/a.js`)
    expect(resolveDebugVariables('${workspaceFolderBasename}', context)).toBe('demo-workspace')
    expect(resolveDebugVariables('${file}', context)).toBe(join(root, 'src', 'main.js'))
    expect(resolveDebugVariables('${env:YOCIM_TEST_ENV}', context)).toBe('from-env')
    delete process.env['YOCIM_TEST_ENV']
  })

  it('keeps unknown variables and rejects ${file} without an active file', () => {
    const context = { workspaceRoot: os.tmpdir() }
    expect(resolveDebugVariables('${unknownVar}', context)).toBe('${unknownVar}')
    expect(() => resolveDebugVariables('${file}', context)).toThrowError(/没有打开的文件/)
  })
})

describe('normalizeLaunchConfig', () => {
  it('accepts node configs and rejects other types or missing program', () => {
    const config = normalizeLaunchConfig(
      {
        name: '调试入口',
        type: 'pwa-node',
        program: 'main.js',
        args: ['--flag'],
        cwd: 'src',
        env: { DEBUG: '1', IGNORED: 2 },
        stopOnEntry: true
      },
      0
    )
    expect(config).toMatchObject({
      id: 'launch:0',
      name: '调试入口',
      type: 'node',
      program: 'main.js',
      args: ['--flag'],
      cwd: 'src',
      env: { DEBUG: '1' },
      stopOnEntry: true,
      source: 'launch.json'
    })

    expect(normalizeLaunchConfig({ type: 'python', program: 'a.py' }, 1)).toBeNull()
    expect(normalizeLaunchConfig({ type: 'node' }, 2)).toBeNull()
    expect(normalizeLaunchConfig(null, 3)).toBeNull()
  })

  it('falls back to a generated name and default stopOnEntry', () => {
    const config = normalizeLaunchConfig({ type: 'node', program: 'index.js' }, 2)
    expect(config?.name).toBe('Node 配置 3')
    expect(config?.stopOnEntry).toBe(false)
    expect(config?.runtimeArgs).toEqual([])
  })
})

describe('configFromPackageMain', () => {
  it('derives a zero-config entry only for script mains', () => {
    expect(configFromPackageMain({ main: './out/main.js' })?.program).toBe('./out/main.js')
    expect(configFromPackageMain({ main: './out/main.ts' })).toBeNull()
    expect(configFromPackageMain({})).toBeNull()
    expect(configFromPackageMain('nope')).toBeNull()
  })
})

describe('buildLaunchPlan', () => {
  const base: DebugConfig = {
    id: 'launch:0',
    name: '调试 main.js',
    type: 'node',
    program: 'main.js',
    args: ['--name', 'demo value'],
    runtimeArgs: [],
    stopOnEntry: false,
    source: 'launch.json'
  }

  it('resolves program/cwd to absolute paths and renders the command line', () => {
    const root = join(os.tmpdir(), 'yocim-plan')
    const plan = buildLaunchPlan({ ...base, cwd: 'src' }, { workspaceRoot: root })
    expect(plan.program).toBe(resolve(root, 'main.js'))
    expect(plan.cwd).toBe(resolve(root, 'src'))
    expect(plan.commandLine).toBe(`node ${resolve(root, 'main.js')} --name "demo value"`)
  })

  it('refuses paths escaping the workspace', () => {
    const root = join(os.tmpdir(), 'yocim-plan')
    expect(() =>
      buildLaunchPlan({ ...base, program: '../outside.js' }, { workspaceRoot: root })
    ).toThrowError(/超出了工作区范围/)
    expect(() => buildLaunchPlan({ ...base, cwd: '../../' }, { workspaceRoot: root })).toThrowError(
      /超出了工作区范围/
    )
  })
})

describe('readLaunchConfigs', () => {
  it('reads launch.json and appends the package.json main entry', async () => {
    const root = await makeWorkspace({
      '.yocim/launch.json': JSON.stringify({
        version: '0.2.0',
        configurations: [
          { name: '调试入口', type: 'node', program: 'main.js' },
          { name: '不支持', type: 'python', program: 'main.py' }
        ]
      }),
      'package.json': JSON.stringify({ name: 'demo', main: 'main.js' })
    })

    const file = await readLaunchConfigs(root)
    expect(file.path).toBe('.yocim/launch.json')
    expect(file.error).toBeUndefined()
    expect(file.configs.map((config) => config.source)).toEqual(['launch.json', 'package.json'])
  })

  it('reports broken JSON instead of throwing', async () => {
    const root = await makeWorkspace({ '.yocim/launch.json': '{ "configurations": [' })
    const file = await readLaunchConfigs(root)
    expect(file.configs).toEqual([])
    expect(file.error).toContain('不是合法 JSON')
  })

  it('returns an empty list when neither file exists', async () => {
    const root = await makeWorkspace({ 'readme.md': '# demo' })
    const file = await readLaunchConfigs(root)
    expect(file).toEqual({ path: null, configs: [] })
  })
})
