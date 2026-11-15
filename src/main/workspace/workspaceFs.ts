import { open, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import {
  FS_LIMITS,
  IGNORED_DIRECTORIES,
  type FsReadFileRequest,
  type FsReadFileResult,
  type FsTreeNode,
  type FsTreeRequest
} from '../../shared/ipc'
import type { WorkspacePathGuard } from './pathGuard'

interface TreeBudget {
  remaining: number
}

function joinRelative(parent: string, name: string): string {
  return parent === '.' || parent === '' ? name : `${parent}/${name}`
}

async function readDirectory(
  absolutePath: string,
  relativePath: string,
  depth: number,
  budget: TreeBudget
): Promise<FsTreeNode[]> {
  let entries
  try {
    entries = await readdir(absolutePath, { withFileTypes: true })
  } catch {
    throw new AppError('E_IO', `无法读取目录：${relativePath}`)
  }

  const sorted = entries
    .filter((entry) => !IGNORED_DIRECTORIES.has(entry.name))
    .sort((a, b) => {
      const order = Number(b.isDirectory()) - Number(a.isDirectory())
      return order !== 0 ? order : a.name.localeCompare(b.name)
    })

  const nodes: FsTreeNode[] = []
  for (const entry of sorted) {
    if (budget.remaining <= 0) break
    // 符号链接不进入文件树，避免通过链接暴露工作区之外的目录结构
    if (!entry.isDirectory() && !entry.isFile()) continue

    budget.remaining -= 1
    const childRelative = joinRelative(relativePath, entry.name)

    if (entry.isDirectory()) {
      const node: FsTreeNode = {
        name: entry.name,
        relativePath: childRelative,
        type: 'directory'
      }
      if (depth > 1) {
        node.children = await readDirectory(
          path.join(absolutePath, entry.name),
          childRelative,
          depth - 1,
          budget
        )
      }
      nodes.push(node)
    } else {
      nodes.push({ name: entry.name, relativePath: childRelative, type: 'file' })
    }
  }

  return nodes
}

export async function readWorkspaceTree(
  guard: WorkspacePathGuard,
  request: FsTreeRequest
): Promise<FsTreeNode[]> {
  const resolved = await guard.resolve(request.relativePath, { mustExist: true })
  const info = await stat(resolved.absolutePath)
  if (!info.isDirectory()) {
    throw new AppError('E_INVALID_INPUT', '目标不是目录')
  }

  return readDirectory(resolved.absolutePath, resolved.relativePath, request.depth, {
    remaining: FS_LIMITS.maxTreeEntries
  })
}

export async function readWorkspaceFile(
  guard: WorkspacePathGuard,
  request: FsReadFileRequest
): Promise<FsReadFileResult> {
  const resolved = await guard.resolve(request.relativePath, { mustExist: true })
  const info = await stat(resolved.absolutePath)
  if (!info.isFile()) {
    throw new AppError('E_INVALID_INPUT', '目标不是文件')
  }

  const limit = FS_LIMITS.maxFileBytes
  const length = Math.min(info.size, limit)
  const buffer = Buffer.alloc(length)

  try {
    const handle = await open(resolved.absolutePath, 'r')
    try {
      await handle.read(buffer, 0, length, 0)
    } finally {
      await handle.close()
    }
  } catch {
    throw new AppError('E_IO', `无法读取文件：${resolved.relativePath}`)
  }

  if (buffer.includes(0)) {
    throw new AppError('E_UNSUPPORTED', '不支持预览二进制文件')
  }

  return {
    relativePath: resolved.relativePath,
    content: buffer.toString('utf8'),
    truncated: info.size > limit,
    size: info.size
  }
}
