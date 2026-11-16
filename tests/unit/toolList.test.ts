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
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-list-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(path.join(workspaceRoot, 'src', 'components'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(path.join(workspaceRoot, 'package.json'), '{\n  "name": "demo"\n}\n')
  await writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'export const a = 1\n')
  await writeFile(path.join(workspaceRoot, 'src', 'index.test.ts'), 'test\n')
  await writeFile(path.join(workspaceRoot, 'src', 'components', 'Button.vue'), '<template />\n')
  await writeFile(path.join(workspaceRoot, 'node_modules', 'pkg', 'index.js'), 'x\n')
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

describe('list_dir 结构浏览', () => {
  it('lists files with size and line count', async () => {
    const outcome = await service.execute(toolCall('list_dir', { relativePath: '' }), context())
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('src/')
    expect(outcome.content).toContain('index.ts  (19 B，1 行)')
    expect(outcome.content).toContain('package.json  (21 B，3 行)')
  })

  it('keeps ignored directories out of the tree', async () => {
    const outcome = await service.execute(toolCall('list_dir', { relativePath: '' }), context())
    expect(outcome.ok).toBe(true)
    expect(outcome.content).not.toContain('node_modules')
  })

  it('filters files by glob and prunes empty directories', async () => {
    const outcome = await service.execute(
      toolCall('list_dir', { relativePath: '', glob: '*.test.ts', depth: 3 }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('index.test.ts')
    expect(outcome.content).not.toContain('package.json')
    expect(outcome.content).not.toContain('components/')
    expect(outcome.content).toContain('glob 过滤')
  })

  it('reports how many files matched the glob', async () => {
    const outcome = await service.execute(
      toolCall('list_dir', { relativePath: 'src', glob: '*.vue', depth: 3 }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('Button.vue')
    expect(outcome.summary).toContain('1 个文件')
  })
})
