import { lstat, mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import {
  FS_LIMITS,
  IGNORED_DIRECTORIES,
  type FsFileVersion,
  type FsReadFileRequest,
  type FsReadFileResult,
  type FsTreeNode,
  type FsTreeRequest,
  type FsWriteFileRequest,
  type FsWriteFileResult
} from '../../shared/ipc'
import type { TimelineService } from './timelineService'
import type { WorkspacePathGuard } from './pathGuard'
import { applyEol, hashContent, normalizeEol } from './searchCore'

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath)
    return true
  } catch {
    return false
  }
}

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
  request: FsReadFileRequest,
  timeline?: TimelineService
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

  const extension = path.extname(resolved.absolutePath).slice(1).toLowerCase()
  const mime = IMAGE_MIME[extension]
  if (mime) {
    const base64 = buffer.toString('base64')
    return {
      relativePath: resolved.relativePath,
      content: '',
      truncated: info.size > limit,
      size: info.size,
      contentHash: hashContent(base64),
      eol: 'lf',
      kind: 'image',
      imageDataUrl: `data:${mime};base64,${base64}`
    }
  }

  if (buffer.includes(0)) {
    throw new AppError('E_UNSUPPORTED', '不支持预览二进制文件')
  }

  const normalized = normalizeEol(buffer.toString('utf8'))
  const contentHash = hashContent(normalized.content)
  if (timeline && request.expectedHash && request.expectedHash !== contentHash) {
    await timeline.snapshot({
      workspaceRoot: guard.root,
      relativePath: resolved.relativePath,
      source: 'external',
      content: normalized.content
    })
  }
  return {
    relativePath: resolved.relativePath,
    content: normalized.content,
    truncated: info.size > limit,
    size: info.size,
    contentHash,
    eol: normalized.eol,
    kind: 'text'
  }
}

/**
 * 编辑器保存 / 另存。保存前用内容 hash 校验文件是否被外部修改；
 * 冲突返回磁盘版本供 UI 选择「覆盖 / 重新加载 / 另存」，并生成外部修改快照。
 * 每次成功写入前后各生成一个用户快照，保证编辑前后版本都可通过时间线回滚。
 */
export async function writeWorkspaceFile(
  guard: WorkspacePathGuard,
  request: FsWriteFileRequest,
  timeline: TimelineService
): Promise<FsWriteFileResult> {
  const content = normalizeEol(request.content).content
  const eol = request.eol ?? 'lf'
  const written = applyEol(content, eol)
  const version: FsFileVersion = {
    content,
    contentHash: hashContent(content),
    eol,
    size: Buffer.byteLength(written, 'utf8')
  }

  if (request.targetPath) {
    const target = await guard.resolveForCreate(request.targetPath)
    if (await pathExists(target.absolutePath)) {
      throw new AppError('E_EXISTS', `已存在同名文件：${path.basename(target.absolutePath)}`)
    }
    await mkdir(path.dirname(target.absolutePath), { recursive: true })
    await writeFile(target.absolutePath, written, 'utf8')
    await timeline.snapshot({
      workspaceRoot: guard.root,
      relativePath: target.relativePath,
      source: 'user',
      content
    })
    return { status: 'saved', relativePath: target.relativePath, version }
  }

  const resolved = await guard.resolve(request.relativePath, { mustExist: true })
  const info = await stat(resolved.absolutePath)
  if (!info.isFile()) throw new AppError('E_INVALID_INPUT', '目标不是文件')

  let raw: string
  try {
    raw = await readFile(resolved.absolutePath, 'utf8')
  } catch {
    throw new AppError('E_IO', `无法读取文件：${resolved.relativePath}`)
  }
  if (raw.includes('\0')) throw new AppError('E_UNSUPPORTED', '不支持保存二进制文件')

  const disk = normalizeEol(raw)
  const diskHash = hashContent(disk.content)
  const changed = Boolean(request.expectedHash) && diskHash !== request.expectedHash

  if (changed) {
    await timeline.snapshot({
      workspaceRoot: guard.root,
      relativePath: resolved.relativePath,
      source: 'external',
      content: disk.content
    })
    if (!request.force) {
      return {
        status: 'conflict',
        relativePath: resolved.relativePath,
        disk: {
          content: disk.content,
          contentHash: diskHash,
          eol: disk.eol,
          size: info.size
        }
      }
    }
  }

  await timeline.snapshot({
    workspaceRoot: guard.root,
    relativePath: resolved.relativePath,
    source: 'user',
    content: disk.content
  })
  const finalEol = request.eol ?? disk.eol
  const finalWritten = applyEol(content, finalEol)
  await writeFile(resolved.absolutePath, finalWritten, 'utf8')
  await timeline.snapshot({
    workspaceRoot: guard.root,
    relativePath: resolved.relativePath,
    source: 'user',
    content
  })
  return {
    status: 'saved',
    relativePath: resolved.relativePath,
    version: {
      content,
      contentHash: hashContent(content),
      eol: finalEol,
      size: Buffer.byteLength(finalWritten, 'utf8')
    }
  }
}
