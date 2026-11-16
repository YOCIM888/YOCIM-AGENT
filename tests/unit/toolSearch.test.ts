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
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'yocim-search-'))
  workspaceRoot = path.join(tempRoot, 'workspace')
  await mkdir(path.join(workspaceRoot, 'src', 'deep'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'docs'), { recursive: true })
  await writeFile(
    path.join(workspaceRoot, 'src', 'alpha.ts'),
    ['export const alpha = 1', '', 'export function beta() {', '  return alpha', '}'].join('\n')
  )
  await writeFile(
    path.join(workspaceRoot, 'src', 'deep', 'gamma.ts'),
    ['export const gamma = 2', 'const alphaLocal = gamma'].join('\n')
  )
  await writeFile(path.join(workspaceRoot, 'docs', 'guide.md'), 'export nothing\n')
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

describe('search_files 基于 ripgrep', () => {
  it('returns file:line:column results with line text', async () => {
    const outcome = await service.execute(toolCall('search_files', { query: 'alpha' }), context())
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('src/alpha.ts:1:14: export const alpha = 1')
    expect(outcome.content).toContain('src/alpha.ts:4:10:   return alpha')
    expect(outcome.summary).toContain('3 条结果')
  })

  it('supports regular expressions', async () => {
    const outcome = await service.execute(
      toolCall('search_files', { query: 'export (const|function)', regex: true }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('src/alpha.ts:1')
    expect(outcome.content).toContain('src/alpha.ts:3')
    expect(outcome.content).toContain('src/deep/gamma.ts:1')
  })

  it('filters by include glob', async () => {
    const outcome = await service.execute(
      toolCall('search_files', { query: 'export', include: '*.md' }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('docs/guide.md:1')
    expect(outcome.content).not.toContain('src/alpha.ts')
  })

  it('scopes results to a relative path', async () => {
    const outcome = await service.execute(
      toolCall('search_files', { query: 'gamma', relativePath: 'src/deep' }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('src/deep/gamma.ts')
    expect(outcome.content).not.toContain('src/alpha.ts')
  })

  it('adds context lines around hits when asked', async () => {
    const outcome = await service.execute(
      toolCall('search_files', { query: 'beta', contextLines: 1 }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('src/alpha.ts')
    expect(outcome.content).toContain('>   3| export function beta() {')
    expect(outcome.content).toContain('   2| ')
    expect(outcome.content).toContain('   4|   return alpha')
  })

  it('is case insensitive by default and case sensitive on demand', async () => {
    const loose = await service.execute(toolCall('search_files', { query: 'ALPHA' }), context())
    expect(loose.ok).toBe(true)
    expect(loose.content).toContain('src/alpha.ts')

    const strict = await service.execute(
      toolCall('search_files', { query: 'ALPHA', caseSensitive: true }),
      context()
    )
    expect(strict.ok).toBe(true)
    expect(strict.content).toContain('未找到匹配')
  })

  it('reports an actionable message when nothing matches', async () => {
    const outcome = await service.execute(
      toolCall('search_files', { query: 'zzz-not-here' }),
      context()
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.content).toContain('未找到匹配')
    expect(outcome.summary).toContain('0 条结果')
  })

  it('rejects an invalid regex instead of crashing', async () => {
    const outcome = await service.execute(
      toolCall('search_files', { query: 'export (', regex: true }),
      context()
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('正')
  })
})
