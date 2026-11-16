import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApprovalManager } from '../../src/main/approval/approvalManager'
import { AuditStore } from '../../src/main/audit/auditStore'
import { createLocalToolFileIo, type ToolFileIo } from '../../src/main/tools/toolFileIo'
import { ToolService, type ToolServiceDeps } from '../../src/main/tools/toolService'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'
import type { ApprovalRequest } from '../../src/shared/approval'

let tempRoot: string
let workspaceRoot: string
let guard: WorkspacePathGuard
let audit: AuditStore
let approvals: ApprovalManager
let requests: ApprovalRequest[]
let service: ToolService

const ORIGINAL = [
  "import { a } from './a'",
  '',
  'export function demo(input: string): string {',
  '  const value = input.trim()',
  '  return value',
  '}',
  ''
].join('\n')

function toolCall(
  name: string,
  args: Record<string, unknown>
): {
  id: string
  name: string
  argumentsJson: string
} {
  return { id: 'call-1', name, argumentsJson: JSON.stringify(args) }
}

function context(): { sessionId: string; runId: string; signal: AbortSignal } {
  return { sessionId: 's', runId: 'r', signal: new AbortController().signal }
}

async function readDemo(): Promise<string> {
  return readFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'utf8')
}

function makeService(overrides: Partial<ToolServiceDeps> = {}): ToolService {
  return new ToolService({
    approvals,
    audit,
    requireGuard: () => guard,
    getApprovalMode: () => 'open',
    ...overrides
  })
}

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-edit-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  guard = await WorkspacePathGuard.create(workspaceRoot)
})

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  await writeFile(path.join(workspaceRoot, 'src', 'demo.ts'), ORIGINAL)
  audit = new AuditStore()
  requests = []
  approvals = new ApprovalManager((request) => requests.push(request))
  service = makeService({ getApprovalMode: () => 'manual' })
})

describe('edit_file 多块补丁', () => {
  it('applies several edits with a single approval', async () => {
    const run = service.execute(
      toolCall('edit_file', {
        relativePath: 'src/demo.ts',
        edits: [
          {
            oldText: "import { a } from './a'",
            newText: "import { a } from './a'\nimport { b } from './b'"
          },
          {
            oldText: '  const value = input.trim()',
            newText: '  const value = input.trim().toLowerCase()'
          },
          { oldText: '  return value', newText: '  return `${b}:${value}`' }
        ]
      }),
      context()
    )
    // diff 预览要先读文件（异步），等审批请求落地
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ tool: 'edit_file', risk: 'medium' })
    expect(requests[0].argsSummary).toContain('3 处修改')
    approvals.respond(requests[0].approvalId, 'approve')

    const outcome = await run
    expect(outcome.ok).toBe(true)
    expect(outcome.summary).toContain('3 处修改')
    const content = await readDemo()
    expect(content).toContain("import { b } from './b'")
    expect(content).toContain('input.trim().toLowerCase()')
    expect(content).toContain('return `${b}:${value}`')
    expect(content.split('\n')).toHaveLength(ORIGINAL.split('\n').length + 1)
    expect(audit.list()[0]).toMatchObject({
      tool: 'edit_file',
      approval: 'approved',
      ok: true
    })
  })

  it('writes nothing when any edit cannot be matched', async () => {
    const openService = makeService()
    const outcome = await openService.execute(
      toolCall('edit_file', {
        relativePath: 'src/demo.ts',
        edits: [
          { oldText: '  return value', newText: '  return value.trim()' },
          { oldText: 'this text does not exist', newText: 'x' }
        ]
      }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('第 2 处修改')
    expect(outcome.content).toContain('找不到')
    expect(await readDemo()).toBe(ORIGINAL)
  })

  it('falls back to whitespace-insensitive matching and flags it', async () => {
    // 原文缩进写成 4 空格，与文件里的 2 空格不一致
    const openService = makeService()
    const outcome = await openService.execute(
      toolCall('edit_file', {
        relativePath: 'src/demo.ts',
        edits: [{ oldText: '    return value', newText: '  return value ?? ""' }]
      }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('模糊匹配')
    const content = await readDemo()
    expect(content).toContain('  return value ?? ""')
    expect(content).not.toContain('  return value\n')
  })

  it('rejects ambiguous matches and lists candidate lines', async () => {
    await writeFile(path.join(workspaceRoot, 'src', 'dup.ts'), 'todo\na\nb\ntodo\n')
    const openService = makeService()
    const outcome = await openService.execute(
      toolCall('edit_file', {
        relativePath: 'src/dup.ts',
        edits: [{ oldText: 'todo', newText: 'done' }]
      }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('匹配了 2 次')
    expect(outcome.content).toContain('第 1, 4 行')
  })

  it('rejects overlapping edits', async () => {
    const openService = makeService()
    const outcome = await openService.execute(
      toolCall('edit_file', {
        relativePath: 'src/demo.ts',
        edits: [
          { oldText: '  const value = input.trim()', newText: '  const value = input' },
          { oldText: 'input.trim()', newText: 'input.trim()' }
        ]
      }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('重叠')
    expect(await readDemo()).toBe(ORIGINAL)
  })

  it('aborts when the file changed after reading', async () => {
    const local = createLocalToolFileIo({ requireGuard: () => guard })
    const racing: ToolFileIo = {
      read: async (relativePath) => {
        const snapshot = await local.read(relativePath)
        await writeFile(
          path.join(workspaceRoot, 'src', 'demo.ts'),
          `${snapshot.content}// tampered\n`
        )
        return snapshot
      },
      write: (relativePath, content, options) => local.write(relativePath, content, options),
      peek: (relativePath) => local.peek(relativePath)
    }
    const racingService = makeService({ fileIo: racing })

    const outcome = await racingService.execute(
      toolCall('edit_file', {
        relativePath: 'src/demo.ts',
        edits: [{ oldText: '  return value', newText: '  return value ?? ""' }]
      }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('读取后被修改')
  })

  it('does not require approval when the mode is open', async () => {
    const openService = makeService()
    const outcome = await openService.execute(
      toolCall('edit_file', {
        relativePath: 'src/demo.ts',
        edits: [{ oldText: '  return value', newText: '  return value ?? ""' }]
      }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(requests).toHaveLength(0)
  })

  it('preserves CRLF line endings when patching', async () => {
    const crlfPath = path.join(workspaceRoot, 'src', 'crlf.ts')
    await writeFile(crlfPath, 'const a = 1\r\nconst b = 2\r\n', 'utf8')
    const openService = makeService()
    const outcome = await openService.execute(
      toolCall('edit_file', {
        relativePath: 'src/crlf.ts',
        edits: [{ oldText: 'const b = 2', newText: 'const b = 3' }]
      }),
      context()
    )
    expect(outcome.ok).toBe(true)
    const raw = await readFile(crlfPath, 'utf8')
    expect(raw).toBe('const a = 1\r\nconst b = 3\r\n')
    expect(raw).not.toContain('const a = 1\nconst b')
  })

  it('rejects writes into ignored directories without asking for approval', async () => {
    const outcome = await service.execute(
      toolCall('edit_file', {
        relativePath: 'node_modules/pkg/index.js',
        edits: [{ oldText: 'a', newText: 'b' }]
      }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('禁止写入')
    expect(requests).toHaveLength(0)
  })
})
