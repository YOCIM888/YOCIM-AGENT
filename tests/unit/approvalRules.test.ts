import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AllowRuleStore } from '../../src/main/approval/allowRules'
import { ApprovalManager } from '../../src/main/approval/approvalManager'
import { AuditStore } from '../../src/main/audit/auditStore'
import { migrate } from '../../src/main/db/database'
import { SettingsRepository } from '../../src/main/db/repositories'
import { buildEditPreview, buildWritePreview } from '../../src/main/tools/editTools'
import { ToolService } from '../../src/main/tools/toolService'
import { createLocalToolFileIo } from '../../src/main/tools/toolFileIo'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'
import type { ApprovalRequest } from '../../src/shared/approval'

let tempRoot: string
let workspaceRoot: string
let guard: WorkspacePathGuard
let audit: AuditStore
let approvals: ApprovalManager
let service: ToolService
let allowRules: AllowRuleStore
let requests: ApprovalRequest[]
let db: DatabaseSync

function context(): { sessionId: string; runId: string; signal: AbortSignal } {
  return { sessionId: 'session-1', runId: 'run-1', signal: new AbortController().signal }
}

function toolCall(
  name: string,
  args: Record<string, unknown>,
  id = 'call-1'
): { id: string; name: string; argumentsJson: string } {
  return { id, name, argumentsJson: JSON.stringify(args) }
}

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-p4-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'docs'), { recursive: true })
  guard = await WorkspacePathGuard.create(workspaceRoot)
})

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

beforeEach(() => {
  db?.close()
  db = new DatabaseSync(':memory:')
  migrate(db)
  const settingsRepo = new SettingsRepository(db)
  allowRules = new AllowRuleStore(settingsRepo)
  audit = new AuditStore()
  requests = []
  approvals = new ApprovalManager((request) => requests.push(request))
  service = new ToolService({
    approvals,
    audit,
    requireGuard: () => guard,
    allowRules,
    fileIo: createLocalToolFileIo({ requireGuard: () => guard })
  })
})

describe('允许规则（T4.2）', () => {
  it('session command rules match exact and prefix commands', () => {
    allowRules.add(
      { kind: 'command', value: 'npm test', scope: 'session', sessionId: 's1' },
      workspaceRoot
    )
    expect(allowRules.matchesCommand(workspaceRoot, 's1', 'npm test')).toContain('npm test')
    expect(allowRules.matchesCommand(workspaceRoot, 's1', 'npm test -- --watch')).toContain(
      'npm test'
    )
    expect(allowRules.matchesCommand(workspaceRoot, 's1', 'npm run build')).toBeNull()
    // 其他会话不共享
    expect(allowRules.matchesCommand(workspaceRoot, 's2', 'npm test')).toBeNull()
  })

  it('project path rules persist across store instances', () => {
    const repo = new SettingsRepository(db)
    const first = new AllowRuleStore(repo)
    first.add({ kind: 'path', value: 'docs', scope: 'project' }, workspaceRoot)

    const second = new AllowRuleStore(repo)
    expect(second.matchesWritePath(workspaceRoot, 'session-1', 'docs/notes/a.md')).toContain('docs')
    expect(second.matchesWritePath(workspaceRoot, 'session-1', 'src/index.ts')).toBeNull()
    // 重复规则去重
    second.add({ kind: 'path', value: 'docs', scope: 'project' }, workspaceRoot)
    expect(second.list(workspaceRoot).length).toBe(1)
  })

  it('a matching rule skips approval but records the rule name in audit', async () => {
    allowRules.add(
      { kind: 'command', value: 'node -e', scope: 'session', sessionId: 'session-1' },
      workspaceRoot
    )
    const outcome = await service.execute(
      toolCall('run_command', { command: 'node -e "console.log(1)"' }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(requests).toHaveLength(0)
    const entry = audit.list().find((item) => item.tool === 'run_command')
    expect(entry?.approval).toBe('approved')
    expect(entry?.argsSummary).toContain('规则')
  })

  it('a git allow rule remembers the subcommand family, not the whole command', async () => {
    const first = service.execute(
      toolCall('run_command', { command: 'git push origin main' }),
      context()
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toHaveLength(1)
    approvals.respond(requests[0].approvalId, 'approve_session')
    await first

    expect(allowRules.matchesCommand(workspaceRoot, 'session-1', 'git push origin dev')).toContain(
      'git push'
    )
    const second = service.execute(
      toolCall('run_command', { command: 'git push origin dev' }),
      context()
    )
    expect((await second).ok).toBe(false) // 非 git 仓库，命令本身失败
    expect(requests).toHaveLength(1) // 但不再弹审批
  })

  it('rules cannot bypass the dangerous-pattern guard', async () => {
    allowRules.add(
      { kind: 'command', value: 'rm', scope: 'session', sessionId: 'session-1' },
      workspaceRoot
    )
    const outcome = await service.execute(
      toolCall('run_command', { command: 'rm -rf /' }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('危险命令')
    expect(requests).toHaveLength(0)
  })
})

describe('diff 预览审批（T4.1/T4.3）', () => {
  it('edit_file approval carries a multi-hunk diff in one request', async () => {
    await writeFile(
      path.join(workspaceRoot, 'src', 'demo.ts'),
      'const a = 1\nconst b = 2\nconst c = 3\nconst d = 4\n'
    )
    const run = service.execute(
      toolCall('edit_file', {
        relativePath: 'src/demo.ts',
        edits: [
          { oldText: 'const b = 2', newText: 'const b = 20' },
          { oldText: 'const d = 4', newText: 'const d = 40' }
        ]
      }),
      context()
    )
    // diff 预览要先读文件（异步），等审批请求落地
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toHaveLength(1)
    expect(requests[0].diff).toBeDefined()
    expect(requests[0].diff?.hunks).toHaveLength(2)
    const first = requests[0].diff!.hunks[0]
    expect(
      first.lines.some((line) => line.type === 'del' && line.text.includes('const b = 2'))
    ).toBe(true)
    expect(
      first.lines.some((line) => line.type === 'add' && line.text.includes('const b = 20'))
    ).toBe(true)

    approvals.respond(requests[0].approvalId, 'approve')
    const outcome = await run
    expect(outcome.ok).toBe(true)
    expect(await readFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'utf8')).toContain(
      'const b = 20'
    )
  })

  it('write_file approval previews the new content', async () => {
    const run = service.execute(
      toolCall('write_file', { relativePath: 'notes/new.md', content: '# 新文件\n正文\n' }),
      context()
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toHaveLength(1)
    expect(requests[0].diff?.isNew).toBe(true)
    expect(requests[0].diff?.hunks[0].lines.some((line) => line.type === 'add')).toBe(true)
    approvals.respond(requests[0].approvalId, 'approve')
    await run
  })

  it('rejects the write when the file changed externally during approval (T4.4)', async () => {
    await writeFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'original\n')
    const run = service.execute(
      toolCall('edit_file', {
        relativePath: 'src/demo.ts',
        edits: [{ oldText: 'original', newText: 'patched' }]
      }),
      context()
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toHaveLength(1)
    // 审批期间外部修改了文件
    await writeFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'modified externally\n')
    approvals.respond(requests[0].approvalId, 'approve')
    const outcome = await run
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('审批期间')
    expect(await readFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'utf8')).toBe(
      'modified externally\n'
    )
  })

  it('skips approval entirely when the write path matches a rule', async () => {
    allowRules.add(
      { kind: 'path', value: 'docs', scope: 'session', sessionId: 'session-1' },
      workspaceRoot
    )
    const outcome = await service.execute(
      toolCall('write_file', { relativePath: 'docs/allowed.md', content: 'ok' }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(requests).toHaveLength(0)
    const entry = audit.list().find((item) => item.tool === 'write_file')
    expect(entry?.approval).toBe('approved')
    expect(entry?.argsSummary).toContain('规则')
  })
})

describe('预览构建', () => {
  it('buildWritePreview marks new files and keeps CRLF notes', async () => {
    const io = createLocalToolFileIo({ requireGuard: () => guard })
    const preview = await buildWritePreview(io, {
      relativePath: 'src/brand-new.md',
      content: '# Title\nBody line\n'
    })
    expect(preview.isNew).toBe(true)
    expect(preview.hunks[0].header).toContain('新建文件')
    expect(preview.hunks[0].lines.map((line) => line.type)).toEqual(['add', 'add'])
  })

  it('buildEditPreview reports fuzzy mode in the hunk header', async () => {
    await writeFile(path.join(workspaceRoot, 'src', 'fuzzy.ts'), '  return value\n')
    const io = createLocalToolFileIo({ requireGuard: () => guard })
    const preview = await buildEditPreview(io, {
      relativePath: 'src/fuzzy.ts',
      edits: [{ oldText: '    return value', newText: '  return 1' }]
    })
    expect(preview.hunks[0].header).toContain('模糊匹配')
    expect(preview.contentHash).toBeTruthy()
  })
})
