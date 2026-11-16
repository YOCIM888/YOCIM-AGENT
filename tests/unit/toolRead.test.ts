import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ApprovalManager } from '../../src/main/approval/approvalManager'
import { AuditStore } from '../../src/main/audit/auditStore'
import { ToolService } from '../../src/main/tools/toolService'
import { WorkspacePathGuard } from '../../src/main/workspace/pathGuard'

let tempRoot: string
let workspaceRoot: string
let guard: WorkspacePathGuard
let service: ToolService

const LINES = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`)

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

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-read-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(path.join(workspaceRoot, 'src', 'lines.txt'), `${LINES.join('\n')}\n`)
  await writeFile(path.join(workspaceRoot, 'src', 'empty.txt'), '')
  guard = await WorkspacePathGuard.create(workspaceRoot)
})

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

beforeEach(() => {
  service = new ToolService({
    approvals: new ApprovalManager(() => undefined),
    audit: new AuditStore(),
    requireGuard: () => guard
  })
})

describe('read_file 行号与分页', () => {
  it('returns numbered lines with a total count header', async () => {
    const outcome = await service.execute(
      toolCall('read_file', { relativePath: 'src/lines.txt' }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('src/lines.txt（共 12 行，显示 1-12）')
    expect(outcome.content).toContain('  1| line 1')
    expect(outcome.content).toContain(' 12| line 12')
  })

  it('pages with offset and limit and hints the next offset', async () => {
    const outcome = await service.execute(
      toolCall('read_file', { relativePath: 'src/lines.txt', offset: 3, limit: 2 }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('显示 3-4）')
    expect(outcome.content).toContain('  3| line 3')
    expect(outcome.content).toContain('  4| line 4')
    expect(outcome.content).not.toContain('line 5')
    expect(outcome.content).toContain('用 offset=5 继续读取')
    expect(outcome.summary).toContain('第 3-4 行 / 共 12 行')
  })

  it('clamps an offset beyond the file end instead of failing', async () => {
    const outcome = await service.execute(
      toolCall('read_file', { relativePath: 'src/lines.txt', offset: 99 }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('12| line 12')
    expect(outcome.content).toContain('超出文件范围')
  })

  it('handles empty files', async () => {
    const outcome = await service.execute(
      toolCall('read_file', { relativePath: 'src/empty.txt' }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('空文件')
  })

  it('rejects an invalid limit before touching the file', async () => {
    const outcome = await service.execute(
      toolCall('read_file', { relativePath: 'src/lines.txt', limit: 5000 }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toContain('参数校验失败')
  })
})
