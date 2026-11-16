import { readFile, stat } from 'node:fs/promises'
import type { ToolExecutionOutcome } from '../../shared/agent'
import { FS_LIMITS, type FsTreeNode } from '../../shared/ipc'
import type { WorkspacePathGuard } from '../workspace/pathGuard'
import { matchesGlob, parsePatterns } from '../workspace/searchCore'
import { readWorkspaceTree } from '../workspace/workspaceFs'
import type { ListDirArgs } from './toolSchemas'

/** 文件条目超过这个数量时不再统计行数：一次 list_dir 不值得读几十个文件 */
const LINE_COUNT_MAX_FILES = 40
const LINE_COUNT_MAX_BYTES = 32 * 1024

interface FileMeta {
  size: number
  lines: number | null
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function collectFiles(nodes: FsTreeNode[], out: FsTreeNode[] = []): FsTreeNode[] {
  for (const node of nodes) {
    if (node.type === 'file') out.push(node)
    else if (node.children) collectFiles(node.children, out)
  }
  return out
}

function countNodes(nodes: FsTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + (node.children ? countNodes(node.children) : 0), 0)
}

/** glob 只作用于文件：目录条目保留结构，但过滤后为空的目录直接剪掉。 */
function filterByGlob(nodes: FsTreeNode[], patterns: string[]): FsTreeNode[] {
  if (!patterns.length) return nodes
  const keep = (node: FsTreeNode): boolean =>
    node.type === 'file' && patterns.some((pattern) => matchesGlob(node.relativePath, pattern))

  const walk = (items: FsTreeNode[]): FsTreeNode[] => {
    const result: FsTreeNode[] = []
    for (const node of items) {
      if (node.type === 'file') {
        if (keep(node)) result.push(node)
        continue
      }
      if (!node.children) {
        result.push(node)
        continue
      }
      const children = walk(node.children)
      if (children.length) result.push({ ...node, children })
    }
    return result
  }
  return walk(nodes)
}

async function readFileMeta(
  guard: WorkspacePathGuard,
  node: FsTreeNode,
  withLines: boolean
): Promise<FileMeta> {
  try {
    const resolved = await guard.resolve(node.relativePath, { mustExist: true })
    const info = await stat(resolved.absolutePath)
    if (!withLines || info.size > LINE_COUNT_MAX_BYTES) {
      return { size: info.size, lines: null }
    }
    const raw = await readFile(resolved.absolutePath, 'utf8')
    if (raw.includes('\0')) return { size: info.size, lines: null }
    const normalized = raw.endsWith('\n') ? raw.slice(0, -1) : raw
    return { size: info.size, lines: normalized ? normalized.split('\n').length : 0 }
  } catch {
    return { size: 0, lines: null }
  }
}

function renderTree(nodes: FsTreeNode[], meta: Map<string, FileMeta>): string[] {
  const lines: string[] = []
  const walk = (items: FsTreeNode[], indent: number): void => {
    for (const node of items) {
      const pad = '  '.repeat(indent)
      if (node.type === 'directory') {
        lines.push(`${pad}${node.name}/`)
        if (node.children) walk(node.children, indent + 1)
        continue
      }
      const info = meta.get(node.relativePath)
      const detail = info
        ? `  (${formatSize(info.size)}${info.lines === null ? '' : `，${info.lines} 行`})`
        : ''
      lines.push(`${pad}${node.name}${detail}`)
    }
  }
  walk(nodes, 0)
  return lines
}

export async function runListDir(
  guard: WorkspacePathGuard,
  args: ListDirArgs
): Promise<ToolExecutionOutcome> {
  const tree = await readWorkspaceTree(guard, {
    relativePath: args.relativePath,
    depth: args.depth
  })

  const filters = parsePatterns(args.glob)
  const nodes = filterByGlob(tree, filters)
  const files = collectFiles(nodes)
  const totalBeforeFilter = collectFiles(tree).length

  const withLines = files.length <= LINE_COUNT_MAX_FILES
  const meta = new Map<string, FileMeta>()
  await Promise.all(
    files.map(async (node) => {
      meta.set(node.relativePath, await readFileMeta(guard, node, withLines))
    })
  )

  const lines = renderTree(nodes, meta)
  const hints: string[] = []
  if (countNodes(tree) >= FS_LIMITS.maxTreeEntries) {
    hints.push(
      `[条目数已达上限 ${FS_LIMITS.maxTreeEntries}，结果可能不完整：请用 glob 收窄或用 search_files 精确定位]`
    )
  }
  if (filters.length) {
    hints.push(
      `[glob 过滤：${filters.join(', ')}，命中 ${files.length}/${totalBeforeFilter} 个文件]`
    )
  }

  const target = args.relativePath || '.'
  const content = lines.length ? [...lines, ...hints].join('\n') : '（空目录）'
  return {
    ok: true,
    content,
    summary: `${target}：${files.length} 个文件${
      filters.length ? `（glob 命中）` : ''
    }${hints.length ? '，结果有截断或过滤提示' : ''}`
  }
}
