import { describe, expect, it } from 'vitest'
import {
  allowRuleValue,
  classifyCommand,
  needsApproval,
  type CommandRisk
} from '../../src/main/tools/commandRisk'
import type { ApprovalMode } from '../../src/shared/approval'

describe('classifyCommand', () => {
  it('treats observation commands as readonly', async () => {
    for (const command of [
      'git status',
      'git diff --stat',
      'git log -n 3',
      'git blame src/a.ts',
      'git tag',
      'git stash list',
      'git --version',
      'node -v',
      'npm --help'
    ]) {
      expect((await classifyCommand(command)).risk, command).toBe('readonly')
    }
  })

  it('treats local reversible commands as local', async () => {
    for (const command of [
      'git add .',
      'git commit -m "x"',
      'git fetch origin',
      'git branch feature',
      'npm test',
      'python script.py'
    ]) {
      expect((await classifyCommand(command)).risk, command).toBe('local')
    }
  })

  it('treats remote and destructive commands as external', async () => {
    const push = await classifyCommand('git push origin main')
    expect(push.risk).toBe('external')
    expect(push.reason).toContain('推送')

    for (const command of [
      'git merge feature',
      'git reset --hard HEAD~1',
      'git clean -fd',
      'git branch -D feature',
      'git stash pop',
      'npm publish'
    ]) {
      expect((await classifyCommand(command)).risk, command).toBe('external')
    }
  })

  it('downgrades git pull when the worktree is clean', async () => {
    const clean = await classifyCommand('git pull --ff-only', async () => false)
    expect(clean.risk).toBe('local')
    expect(clean.reason).toContain('干净')

    const dirty = await classifyCommand('git pull --ff-only', async () => true)
    expect(dirty.risk).toBe('external')
    expect(dirty.reason).toContain('未提交改动')
  })

  it('does not query worktree state except for pull', async () => {
    let queried = false
    await classifyCommand('git status', async () => {
      queried = true
      return true
    })
    expect(queried).toBe(false)
  })
})

describe('needsApproval', () => {
  const matrix: Array<[CommandRisk, ApprovalMode, boolean]> = [
    ['readonly', 'manual', false],
    ['readonly', 'auto', false],
    ['readonly', 'open', false],
    ['local', 'manual', true],
    ['local', 'auto', false],
    ['local', 'open', false],
    ['external', 'manual', true],
    ['external', 'auto', true],
    ['external', 'open', false]
  ]

  it.each(matrix)('%s in %s mode -> %s', (risk, mode, expected) => {
    expect(needsApproval(risk, mode)).toBe(expected)
  })
})

describe('allowRuleValue', () => {
  it('uses a git subcommand family so one approval covers variants', () => {
    expect(allowRuleValue('git push origin main')).toBe('git push')
    expect(allowRuleValue('git pull --ff-only')).toBe('git pull')
    expect(allowRuleValue('GIT   COMMIT   -m  x')).toBe('git commit')
  })

  it('keeps the full command for non-git programs', () => {
    expect(allowRuleValue('npm test -- --watch')).toBe('npm test -- --watch')
    expect(allowRuleValue('node -p 1')).toBe('node -p 1')
  })
})
