import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApprovalManager } from '../../src/main/approval/approvalManager'
import { AuditStore } from '../../src/main/audit/auditStore'
import { migrate } from '../../src/main/db/database'
import { FileHistoryRepository } from '../../src/main/db/repositories'
import { ToolService } from '../../src/main/tools/toolService'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'
import { TimelineService } from '../../src/main/workspace/timelineService'
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
    // diff 预览要先读文件（异步），等审批请求落地
    await new Promise((resolve) => setTimeout(resolve, 50))
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
    // diff 预览要先读文件（异步），等审批请求落地
    await new Promise((resolve) => setTimeout(resolve, 50))
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

  it('applies a single patch through edit_file', async () => {
    await mkdir(path.join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(path.join(workspaceRoot, 'notes', 'patch.txt'), 'alpha beta gamma')
    const run = service.execute(
      toolCall('edit_file', {
        relativePath: 'notes/patch.txt',
        edits: [{ oldText: 'beta', newText: 'BETA' }]
      }),
      context()
    )
    // diff 预览要先读文件（异步），等审批请求落地
    await new Promise((resolve) => setTimeout(resolve, 50))
    approvals.respond(requests[0].approvalId, 'approve')
    const outcome = await run

    expect(outcome.ok).toBe(true)
    expect(await readFile(path.join(workspaceRoot, 'notes', 'patch.txt'), 'utf8')).toBe(
      'alpha BETA gamma'
    )
  })

  it('rejects a write_file call without content', async () => {
    const outcome = await service.execute(
      toolCall('write_file', { relativePath: 'notes/empty-args.txt' }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('参数校验失败')
    expect(requests).toHaveLength(0)
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
  it('auto mode approves local writes and commands without requests', async () => {
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

    const commandOutcome = await autoService.execute(
      toolCall('run_command', { command: 'node -e "console.log(1)"' }),
      context()
    )
    expect(commandOutcome.ok).toBe(true)
    expect(requests).toHaveLength(0)
    // AuditStore.list() 按时间倒序，最新一条就是刚执行的命令
    expect(audit.list()[0]).toMatchObject({
      tool: 'run_command',
      approval: 'not_required',
      ok: true
    })
  })

  it('auto mode still asks for external commands', async () => {
    const autoService = new ToolService({
      approvals,
      audit,
      requireGuard: () => guard,
      getApprovalMode: () => 'auto'
    })

    const run = autoService.execute(
      toolCall('run_command', { command: 'git push origin main' }),
      context()
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ tool: 'run_command', risk: 'high' })
    expect(requests[0].reason).toContain('推送')
    approvals.respond(requests[0].approvalId, 'approve')
    // 测试工作区不是 git 仓库，命令本身会失败；这里只验证审批流程
    await run
    expect(audit.list()[0]).toMatchObject({ tool: 'run_command', approval: 'approved' })
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

describe('command risk tiers by approval mode', () => {
  function makeService(mode: 'manual' | 'auto' | 'open', dirty = true): ToolService {
    return new ToolService({
      approvals,
      audit,
      requireGuard: () => guard,
      getApprovalMode: () => mode,
      isWorktreeDirty: async () => dirty
    })
  }

  const settleApproval = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  it('readonly commands skip approval in every mode', async () => {
    for (const mode of ['manual', 'auto', 'open'] as const) {
      requests.length = 0
      const outcome = await makeService(mode).execute(
        toolCall('run_command', { command: 'git --version' }),
        context()
      )
      expect(outcome.ok).toBe(true)
      expect(outcome.content).toContain('git version')
      expect(requests).toHaveLength(0)
    }
  })

  it('local commands ask only in manual mode', async () => {
    const manualRun = makeService('manual').execute(
      toolCall('run_command', { command: 'node -p 1' }),
      context()
    )
    await settleApproval()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ tool: 'run_command', risk: 'medium' })
    expect(requests[0].reason).toContain('本地')
    approvals.respond(requests[0].approvalId, 'approve')
    expect((await manualRun).ok).toBe(true)

    requests.length = 0
    const autoOutcome = await makeService('auto').execute(
      toolCall('run_command', { command: 'node -p 1' }),
      context()
    )
    expect(autoOutcome.ok).toBe(true)
    expect(requests).toHaveLength(0)
  })

  it('external git commands ask in manual and auto modes', async () => {
    for (const mode of ['manual', 'auto'] as const) {
      requests.length = 0
      const run = makeService(mode).execute(
        toolCall('run_command', { command: 'git push origin main' }),
        context()
      )
      await settleApproval()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ tool: 'run_command', risk: 'high' })
      expect(requests[0].reason).toContain('推送')
      approvals.respond(requests[0].approvalId, 'approve')
      await run
      expect(audit.list().at(-1)).toMatchObject({ tool: 'run_command', approval: 'approved' })
    }
  })

  it('git pull asks only when the worktree is dirty', async () => {
    await makeService('auto', false).execute(
      toolCall('run_command', { command: 'git pull --ff-only' }),
      context()
    )
    expect(requests).toHaveLength(0)

    const run = makeService('auto', true).execute(
      toolCall('run_command', { command: 'git pull --ff-only' }),
      context()
    )
    await settleApproval()
    expect(requests).toHaveLength(1)
    expect(requests[0].reason).toContain('未提交改动')
    approvals.respond(requests[0].approvalId, 'approve')
    await run
  })

  it('open mode asks before running a blocked dangerous command', async () => {
    const run = makeService('open').execute(
      toolCall('run_command', { command: 'echo rm -rf' }),
      context()
    )
    await settleApproval()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: 'blocked', risk: 'high', tool: 'run_command' })
    expect(requests[0].reason).toContain('危险命令')

    // 拒绝时不执行
    approvals.respond(requests[0].approvalId, 'deny')
    const denied = await run
    expect(denied.ok).toBe(false)
    expect(denied.content).toContain('用户拒绝')
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
    // 白名单加载是异步的（读 .yocim/commands.json），等审批请求落地
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ tool: 'run_command', risk: 'medium' })
    expect(requests[0].reason).toContain('本地')
    approvals.respond(requests[0].approvalId, 'approve')

    const outcome = await run
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('hi')
    expect(audit.list()[0]).toMatchObject({ tool: 'run_command', approval: 'approved', ok: true })
  })
})

describe('command whitelist in open mode', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  function openService(whitelist: string[], onAdd?: (command: string) => void): ToolService {
    return new ToolService({
      approvals,
      audit,
      requireGuard: () => guard,
      getApprovalMode: () => 'open',
      getCommandWhitelist: () => whitelist,
      addCommandToWhitelist: onAdd
    })
  }

  it('runs whitelisted commands without any approval card', async () => {
    const outcome = await openService(['echo']).execute(
      toolCall('run_command', { command: 'echo whitelisted' }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('whitelisted')
    expect(requests).toHaveLength(0)
    expect(audit.list()[0]).toMatchObject({ approval: 'not_required', ok: true })
  })

  it('allows a blocked command once without persisting it', async () => {
    const added: string[] = []
    const serviceOnce = openService([], (command) => added.push(command))
    const run = serviceOnce.execute(toolCall('run_command', { command: 'echo rm -rf' }), context())
    await settle()
    expect(requests).toHaveLength(1)
    approvals.respond(requests[0].approvalId, 'allow_once')

    const outcome = await run
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('rm -rf')
    expect(added).toEqual([])
    expect(audit.list().at(-1)).toMatchObject({ approval: 'approved', ok: true })

    // 「仅一次」不写入白名单：下一次仍要处理
    requests.length = 0
    const again = serviceOnce.execute(
      toolCall('run_command', { command: 'echo rm -rf' }),
      context()
    )
    await settle()
    expect(requests).toHaveLength(1)
    approvals.respond(requests[0].approvalId, 'deny')
    expect((await again).ok).toBe(false)
  })

  it('adds a blocked command to the whitelist and reuses it in later runs', async () => {
    const added: string[] = []
    const command = 'echo add-me'
    const first = openService([], (value) => added.push(value)).execute(
      toolCall('run_command', { command }),
      context()
    )
    await settle()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: 'blocked' })
    expect(requests[0].reason).toContain('白名单')
    approvals.respond(requests[0].approvalId, 'allow_whitelist')
    expect((await first).ok).toBe(true)
    expect(added).toEqual([command])

    // 模拟设置已落盘：后续任务从 getter 读到新白名单
    requests.length = 0
    const second = await openService(added).execute(toolCall('run_command', { command }), context())
    expect(second.ok).toBe(true)
    expect(requests).toHaveLength(0)
  })

  it('keeps hard interception in non-open modes even if the command is whitelisted', async () => {
    const outcome = await new ToolService({
      approvals,
      audit,
      requireGuard: () => guard,
      getApprovalMode: () => 'auto',
      getCommandWhitelist: () => ['echo'],
      addCommandToWhitelist: () => {
        throw new Error('should not be called')
      }
    }).execute(toolCall('run_command', { command: 'echo blocked' }), context())
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('白名单')
    expect(requests).toHaveLength(0)
  })
})

describe('write_file timeline snapshot', () => {
  function makeTimeline(): { timeline: TimelineService; db: DatabaseSync } {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const timeline = new TimelineService({
      history: new FileHistoryRepository(db),
      baseDir: path.join(tempRoot, 'timeline-hook')
    })
    return { timeline, db }
  }

  it('captures an agent snapshot after a successful write', async () => {
    const { timeline, db } = makeTimeline()
    const hooked = new ToolService({
      approvals,
      audit,
      requireGuard: () => guard,
      getApprovalMode: () => 'open',
      timeline
    })
    const outcome = await hooked.execute(
      toolCall('write_file', { relativePath: 'notes/hooked.txt', content: 'snapshot me' }),
      context()
    )
    expect(outcome.ok).toBe(true)
    const entries = timeline.list(guard.root, 'notes/hooked.txt')
    expect(entries).toHaveLength(1)
    expect(entries[0].source).toBe('agent')
    expect((await timeline.read(entries[0].id)).content).toBe('snapshot me')
    db.close()
  })

  it('does not snapshot a denied write', async () => {
    const { timeline, db } = makeTimeline()
    const hooked = new ToolService({ approvals, audit, requireGuard: () => guard, timeline })
    const run = hooked.execute(
      toolCall('write_file', { relativePath: 'notes/hook-denied.txt', content: 'x' }),
      context()
    )
    // diff 预览要先读文件（异步），等审批请求落地
    await new Promise((resolve) => setTimeout(resolve, 50))
    approvals.respond(requests[0].approvalId, 'deny')
    expect((await run).ok).toBe(false)
    expect(timeline.list(guard.root, 'notes/hook-denied.txt')).toHaveLength(0)
    db.close()
  })
})

describe('verification tools go through approval and command policy', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40))

  for (const name of ['run_tests', 'run_typecheck', 'run_lint']) {
    it(`${name} asks for approval in manual mode (no silent bypass)`, async () => {
      const args =
        name === 'run_tests'
          ? { runner: 'vitest', pattern: 'foo.test.ts' }
          : name === 'run_lint'
            ? { relativePath: 'src' }
            : {}
      const run = service.execute(toolCall(name, args), context())
      await settle()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ tool: name, risk: 'medium' })
      expect(requests[0].reason).toContain('验证命令')
      // 拒绝后不执行任何命令
      approvals.respond(requests[0].approvalId, 'deny')
      const outcome = await run
      expect(outcome.ok).toBe(false)
      expect(outcome.summary).toContain('拒绝')
      expect(audit.list()[0]).toMatchObject({ tool: name, approval: 'denied', ok: false })
    })
  }

  it('rejects shell injection in run_lint target before any approval is shown', async () => {
    const outcome = await service.execute(
      toolCall('run_lint', { relativePath: 'package.json; echo INJECTED > marker.txt' }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('不允许的字符')
    expect(requests).toHaveLength(0)
    expect(audit.list()[0]).toMatchObject({ ok: false })
  })

  it('rejects injection / flag injection in run_tests pattern before approval', async () => {
    for (const pattern of ['--version; echo INJECTED > marker.txt', '--fix', '-u']) {
      const outcome = await service.execute(
        toolCall('run_tests', { runner: 'vitest', pattern }),
        context()
      )
      expect(outcome.ok).toBe(false)
      expect(requests).toHaveLength(0)
    }
  })

  it('blocked dangerous pattern in run_tests shows a blocked card in open mode', async () => {
    const open = new ToolService({
      approvals,
      audit,
      requireGuard: () => guard,
      getApprovalMode: () => 'open'
    })
    // shutdown 是纯字母、通过字符白名单且不触发 - 开头选项检查，
    // 但命中危险正则（系统级危险命令），应被硬拦截。
    const run = open.execute(
      toolCall('run_tests', { runner: 'vitest', pattern: 'shutdown' }),
      context()
    )
    await settle()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: 'blocked', tool: 'run_tests' })
    approvals.respond(requests[0].approvalId, 'deny')
    expect((await run).ok).toBe(false)
  })
})
