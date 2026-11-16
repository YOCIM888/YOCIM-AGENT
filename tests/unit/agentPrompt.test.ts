import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../../src/main/agent/prompt'
import { loadWorkspaceRules } from '../../src/main/agent/rules'

let tempRoot: string
let workspaceRoot: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-prompt-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(path.join(workspaceRoot, '.yocim'), { recursive: true })
  await writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# 项目规则\n\n- 禁止使用 any\n')
  await writeFile(path.join(workspaceRoot, '.yocim', 'rules.md'), '- 测试必须先写\n')
})

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('loadWorkspaceRules', () => {
  it('merges AGENTS.md and .yocim/rules.md', async () => {
    const rules = await loadWorkspaceRules(workspaceRoot)
    expect(rules?.sources).toEqual(['AGENTS.md', '.yocim/rules.md'])
    expect(rules?.content).toContain('禁止使用 any')
    expect(rules?.content).toContain('测试必须先写')
  })

  it('returns null without a workspace or rule files', async () => {
    expect(await loadWorkspaceRules(null)).toBeNull()
    expect(await loadWorkspaceRules(tempRoot)).toBeNull()
  })

  it('truncates oversized rule files', async () => {
    const bigRoot = path.join(tempRoot, 'big')
    await mkdir(bigRoot, { recursive: true })
    await writeFile(path.join(bigRoot, 'AGENTS.md'), '长'.repeat(20_000))
    const rules = await loadWorkspaceRules(bigRoot)
    expect(rules?.content.length).toBeLessThanOrEqual(8100)
    expect(rules?.content).toContain('已截断')
  })
})

describe('buildSystemPrompt', () => {
  it('includes environment, rules, repo map and hint sections', () => {
    const prompt = buildSystemPrompt({
      platform: 'win32',
      workspace: { name: 'demo', root: 'E:/demo', remote: null },
      rules: { content: '禁止使用 any', sources: ['AGENTS.md'] },
      repoMap: 'src/（如 main、renderer），含 3 个子目录',
      hint: {
        activeFile: 'src/a.ts',
        selection: { startLine: 3, endLine: 9 },
        dirtyFiles: ['src/b.ts']
      }
    })

    expect(prompt).toContain('win32')
    expect(prompt).toContain('demo')
    expect(prompt).toContain('AGENTS.md')
    expect(prompt).toContain('禁止使用 any')
    expect(prompt).toContain('src/（如 main')
    expect(prompt).toContain('src/a.ts（第 3-9 行）')
    expect(prompt).toContain('src/b.ts')
    expect(prompt).toContain('edit_file')
    expect(prompt).toContain('不是指令')
  })

  it('warns about SSH workspaces instead of promising file tools', () => {
    const prompt = buildSystemPrompt({
      platform: 'linux',
      workspace: { name: 'remote', root: 'ssh://host', remote: 'ssh' },
      rules: null,
      repoMap: null,
      hint: null
    })
    expect(prompt).toContain('SSH 远程工作区')
  })

  it('omits empty sections to keep the prompt compact', () => {
    const prompt = buildSystemPrompt({
      platform: 'darwin',
      workspace: null,
      rules: null,
      repoMap: null,
      hint: null
    })
    expect(prompt).not.toContain('## 项目规则')
    expect(prompt).not.toContain('## 项目结构')
    expect(prompt).not.toContain('## 当前处境')
    expect(prompt).toContain('YOCIM AGENT')
  })
})
