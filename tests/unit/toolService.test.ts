import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApprovalManager } from '../../src/main/approval/approvalManager'
import { AuditStore } from '../../src/main/audit/auditStore'
import { ToolService } from '../../src/main/tools/toolService'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'
import type { ApprovalRequest } from '../../src/shared/approval'

let tempRoot: string
let workspaceRoot: string
let guard: WorkspacePathGuard
let audit: AuditStore
let approvals: ApprovalManager
let service: ToolService
let requests: ApprovalRequest[]

function context(): { sessionId: string; runId: string; signal: AbortSignal } {
  return { sessionId: 'session-1', runId: 'run-1', signal: new AbortController().signal }
}

function toolCall(
  name: string,
  args: Record<string, unknown>,
  id = 'call-1'
): {
  id: string
  name: string
  argumentsJson: string
} {
  return { id, name, argumentsJson: JSON.stringify(args) }
}

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-tools-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(path.join(workspaceRoot, 'README.md'), '# YOCIM\n')
  await writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'export const ok = true\n')
  guard = await WorkspacePathGuard.create(workspaceRoot)
})

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

beforeEach(() => {
  audit = new AuditStore()
  requests = []
  approvals = new ApprovalManager((request) => requests.push(request))
  service = new ToolService({ approvals, audit, requireGuard: () => guard })
})

describe('read-only tools', () => {
  it('reads a file without approval and records audit', async () => {
    const outcome = await service.execute(
      toolCall('read_file', { relativePath: 'README.md' }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('# YOCIM')
    expect(requests).toHaveLength(0)
    expect(audit.list()[0]).toMatchObject({
      tool: 'read_file',
      approval: 'not_required',
      ok: true
    })
  })

  it('searches file contents', async () => {
    const outcome = await service.execute(toolCall('search_files', { query: 'export' }), context())
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('src/index.ts:1')
  })

  it('rejects path escapes before executing', async () => {
    const outcome = await service.execute(
      toolCall('read_file', { relativePath: '../outside.txt' }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('上级目录')
    expect(requests).toHaveLength(0)
    expect(audit.list()[0]).toMatchObject({ ok: false })
  })
})

describe('write_file approval', () => {
  it('writes after approval and audits the decision', async () => {
    const run = service.execute(
      toolCall('write_file', { relativePath: 'notes/demo.txt', content: 'hello write' }),
      context()
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ tool: 'write_file', risk: 'medium' })
    expect(approvals.respond(requests[0].approvalId, 'approve')).toBe(true)

    const outcome = await run
    expect(outcome.ok).toBe(true)
    expect(await readFile(path.join(workspaceRoot, 'notes', 'demo.txt'), 'utf8')).toBe(
      'hello write'
    )
    expect(audit.list()[0]).toMatchObject({ tool: 'write_file', approval: 'approved', ok: true })
  })

  it('does not write when approval is denied', async () => {
    const run = service.execute(
      toolCall('write_file', { relativePath: 'notes/denied.txt', content: 'nope' }),
      context()
    )
    expect(requests).toHaveLength(1)
    approvals.respond(requests[0].approvalId, 'deny')

    const outcome = await run
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('拒绝')
    await expect(
      readFile(path.join(workspaceRoot, 'notes', 'denied.txt'), 'utf8')
    ).rejects.toThrow()
    expect(audit.list()[0]).toMatchObject({ approval: 'denied', ok: false })
  })

  it('applies a patch when oldText matches exactly once', async () => {
    await mkdir(path.join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(path.join(workspaceRoot, 'notes', 'patch.txt'), 'alpha beta gamma')
    const run = service.execute(
      toolCall('write_file', {
        relativePath: 'notes/patch.txt',
        oldText: 'beta',
        newText: 'BETA'
      }),
      context()
    )
    approvals.respond(requests[0].approvalId, 'approve')
    const outcome = await run

    expect(outcome.ok).toBe(true)
    expect(await readFile(path.join(workspaceRoot, 'notes', 'patch.txt'), 'utf8')).toBe(
      'alpha BETA gamma'
    )
  })

  it('rejects writes into ignored directories without asking for approval', async () => {
    const outcome = await service.execute(
      toolCall('write_file', { relativePath: 'node_modules/pkg.js', content: 'x' }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('禁止写入')
    expect(requests).toHaveLength(0)
  })

  it('treats abort during approval as denied', async () => {
    const controller = new AbortController()
    const run = service.execute(
      toolCall('write_file', { relativePath: 'notes/aborted.txt', content: 'x' }),
      { sessionId: 'session-1', runId: 'run-1', signal: controller.signal }
    )
    controller.abort()

    const outcome = await run
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('拒绝')
    expect(audit.list()[0]).toMatchObject({ approval: 'denied', ok: false })
  })
})

describe('approval modes', () => {
  it('auto mode approves writes but still asks for commands', async () => {
    const autoService = new ToolService({
      approvals,
      audit,
      requireGuard: () => guard,
      getApprovalMode: () => 'auto'
    })

    const writeOutcome = await autoService.execute(
      toolCall('write_file', { relativePath: 'notes/auto.txt', content: 'auto' }),
      context()
    )
    expect(writeOutcome.ok).toBe(true)
    expect(requests).toHaveLength(0)
    expect(await readFile(path.join(workspaceRoot, 'notes', 'auto.txt'), 'utf8')).toBe('auto')
    expect(audit.list()[0]).toMatchObject({
      tool: 'write_file',
      approval: 'not_required',
      ok: true
    })

    const commandRun = autoService.execute(
      toolCall('run_command', { command: 'node -e "console.log(1)"' }),
      context()
    )
    expect(requests).toHaveLength(1)
    approvals.respond(requests[0].approvalId, 'approve')
    expect((await commandRun).ok).toBe(true)
  })

  it('open mode approves writes and commands without requests', async () => {
    const openService = new ToolService({
      approvals,
      audit,
      requireGuard: () => guard,
      getApprovalMode: () => 'open'
    })

    const writeOutcome = await openService.execute(
      toolCall('write_file', { relativePath: 'notes/open.txt', content: 'open' }),
      context()
    )
    expect(writeOutcome.ok).toBe(true)

    const commandOutcome = await openService.execute(
      toolCall('run_command', { command: 'node -e "console.log(2)"' }),
      context()
    )
    expect(commandOutcome.ok).toBe(true)
    expect(requests).toHaveLength(0)
    expect(audit.list()[0]).toMatchObject({
      tool: 'run_command',
      approval: 'not_required',
      ok: true
    })
  })
})

describe('run_command protection', () => {
  it('rejects dangerous commands without approval', async () => {
    const outcome = await service.execute(
      toolCall('run_command', { command: 'rm -rf /' }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('危险命令')
    expect(requests).toHaveLength(0)
  })

  it('rejects commands outside the whitelist', async () => {
    const outcome = await service.execute(
      toolCall('run_command', { command: 'powershell -Command "Get-ChildItem"' }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('白名单')
    expect(requests).toHaveLength(0)
  })

  it('executes whitelisted commands after approval', async () => {
    const run = service.execute(
      toolCall('run_command', { command: 'node -e "console.log(\'hi\')"' }),
      context()
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ tool: 'run_command', risk: 'high' })
    approvals.respond(requests[0].approvalId, 'approve')

    const outcome = await run
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('hi')
    expect(audit.list()[0]).toMatchObject({ tool: 'run_command', approval: 'approved', ok: true })
  })
})
