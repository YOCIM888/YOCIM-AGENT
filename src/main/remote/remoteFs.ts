import type { FileEntry, SFTPWrapper, Stats } from 'ssh2'
import { AppError } from '../../shared/errors'
import {
  FS_LIMITS,
  IGNORED_DIRECTORIES,
  type FsConflictResolution,
  type FsCreateEntryRequest,
  type FsFileVersion,
  type FsReadFileRequest,
  type FsReadFileResult,
  type FsRenameRequest,
  type FsTransferRequest,
  type FsTransferResult,
  type FsTreeNode,
  type FsTreeRequest,
  type FsWriteFileRequest,
  type FsWriteFileResult
} from '../../shared/ipc'
import { applyEol, hashContent, normalizeEol } from '../workspace/searchCore'
import type { TimelineService } from '../workspace/timelineService'
import { assertValidEntryName } from '../workspace/fileExplorer'
import { joinRemotePath } from './command'

/**
 * SSH 工作区的文件读写（SFTP）。
 *
 * 只支持「浏览 / 编辑 / 新建 / 重命名 / 删除 / 复制 / 移动」这些第一阶段承诺的操作，
 * 全部通过 SFTP 协议完成，不经过 shell，避免路径与空白字符的转义问题。
 */

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

type Sftp = SFTPWrapper

/** ssh2 的 readdir 只给 Attributes（无 is* 辅助方法），按 POSIX mode 判断类型 */
const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFREG = 0o100000
const S_IFLNK = 0o120000

function isDir(attrs: { mode: number }): boolean {
  return (attrs.mode & S_IFMT) === S_IFDIR
}

function isFile(attrs: { mode: number }): boolean {
  return (attrs.mode & S_IFMT) === S_IFREG
}

function isLink(attrs: { mode: number }): boolean {
  return (attrs.mode & S_IFMT) === S_IFLNK
}

function sftpError(error: Error & { code?: number }, fallback: string): AppError {
  if (error.code === 2) return new AppError('E_NOT_FOUND', '远端路径不存在')
  if (error.code === 3) return new AppError('E_FORBIDDEN', '远端没有访问权限')
  if (error.code === 4) return new AppError('E_IO', '远端操作失败（权限或磁盘错误）')
  if (error.code === 11) return new AppError('E_INVALID_INPUT', '远端路径不是目录')
  return new AppError('E_IO', `${fallback}：${error.message}`)
}

function readdir(sftp: Sftp, remotePath: string): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, list) => {
      if (error) reject(sftpError(error, '无法读取远端目录'))
      else resolve(list)
    })
  })
}

function readFileBuffer(sftp: Sftp, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(remotePath, (error, data) => {
      if (error) reject(sftpError(error, '无法读取远端文件'))
      else resolve(data)
    })
  })
}

function writeFileBuffer(sftp: Sftp, remotePath: string, data: Buffer | string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, data, (error) => {
      if (error) reject(sftpError(error, '无法写入远端文件'))
      else resolve()
    })
  })
}

function statRemote(sftp: Sftp, remotePath: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (error, attrs) => {
      if (error) reject(sftpError(error, '无法读取远端路径信息'))
      else resolve(attrs as unknown as Stats)
    })
  })
}

function exists(sftp: Sftp, remotePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    sftp.stat(remotePath, (error) => resolve(!error))
  })
}

function mkdirRemote(sftp: Sftp, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (error) => {
      if (error) reject(sftpError(error, '无法创建远端目录'))
      else resolve()
    })
  })
}

function renameRemote(sftp: Sftp, from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(from, to, (error) => {
      if (error) reject(sftpError(error, '无法重命名远端路径'))
      else resolve()
    })
  })
}

function unlinkRemote(sftp: Sftp, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (error) => {
      if (error) reject(sftpError(error, '无法删除远端文件'))
      else resolve()
    })
  })
}

function rmdirRemote(sftp: Sftp, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, (error) => {
      if (error) reject(sftpError(error, '无法删除远端目录'))
      else resolve()
    })
  })
}

function joinRelative(parent: string, name: string): string {
  return parent === '.' || parent === '' ? name : `${parent}/${name}`
}

function splitRelative(relativePath: string): { parent: string; name: string } {
  const separator = relativePath.lastIndexOf('/')
  return separator >= 0
    ? { parent: relativePath.slice(0, separator), name: relativePath.slice(separator + 1) }
    : { parent: '', name: relativePath }
}

async function freeName(sftp: Sftp, root: string, relativePath: string): Promise<string> {
  const { parent, name } = splitRelative(relativePath)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let index = 2; index < 1000; index += 1) {
    const candidate = joinRelative(parent, `${stem} (${index})${extension}`)
    if (!(await exists(sftp, joinRemotePath(root, candidate)))) return candidate
  }
  throw new AppError('E_IO', '无法生成不重名的目标名称')
}

async function copyFile(sftp: Sftp, root: string, source: string, target: string): Promise<void> {
  const data = await readFileBuffer(sftp, joinRemotePath(root, source))
  await writeFileBuffer(sftp, joinRemotePath(root, target), data)
}

async function copyDirectory(
  sftp: Sftp,
  root: string,
  source: string,
  target: string
): Promise<void> {
  await mkdirRemote(sftp, joinRemotePath(root, target))
  const entries = await readdir(sftp, joinRemotePath(root, source))
  for (const entry of entries) {
    if (isLink(entry.attrs)) continue
    const childSource = joinRelative(source, entry.filename)
    const childTarget = joinRelative(target, entry.filename)
    if (isDir(entry.attrs)) {
      await copyDirectory(sftp, root, childSource, childTarget)
    } else if (isFile(entry.attrs)) {
      await copyFile(sftp, root, childSource, childTarget)
    }
  }
}

async function removeTree(sftp: Sftp, root: string, relativePath: string): Promise<void> {
  const absolute = joinRemotePath(root, relativePath)
  const attrs = await statRemote(sftp, absolute)
  if (!attrs.isDirectory()) {
    await unlinkRemote(sftp, absolute)
    return
  }
  const entries = await readdir(sftp, absolute)
  for (const entry of entries) {
    await removeTree(sftp, root, joinRelative(relativePath, entry.filename))
  }
  await rmdirRemote(sftp, absolute)
}

interface TreeBudget {
  remaining: number
}

async function readDirectoryNodes(
  sftp: Sftp,
  root: string,
  relativePath: string,
  depth: number,
  budget: TreeBudget
): Promise<FsTreeNode[]> {
  let entries: FileEntry[]
  try {
    entries = await readdir(sftp, joinRemotePath(root, relativePath))
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('E_IO', `无法读取目录：${relativePath || '.'}`)
  }

  const sorted = entries
    .filter((entry) => !IGNORED_DIRECTORIES.has(entry.filename))
    .filter((entry) => isDir(entry.attrs) || isFile(entry.attrs))
    .sort((a, b) => {
      const order = Number(isDir(b.attrs)) - Number(isDir(a.attrs))
      return order !== 0 ? order : a.filename.localeCompare(b.filename)
    })

  const nodes: FsTreeNode[] = []
  for (const entry of sorted) {
    if (budget.remaining <= 0) break
    budget.remaining -= 1
    const childRelative = joinRelative(relativePath, entry.filename)
    if (isDir(entry.attrs)) {
      const node: FsTreeNode = {
        name: entry.filename,
        relativePath: childRelative,
        type: 'directory'
      }
      if (depth > 1) {
        node.children = await readDirectoryNodes(sftp, root, childRelative, depth - 1, budget)
      }
      nodes.push(node)
    } else {
      nodes.push({ name: entry.filename, relativePath: childRelative, type: 'file' })
    }
  }
  return nodes
}

export async function readRemoteTree(
  sftp: Sftp,
  root: string,
  request: FsTreeRequest
): Promise<FsTreeNode[]> {
  const relative = request.relativePath.replace(/^\/+/, '')
  const attrs = await statRemote(sftp, joinRemotePath(root, relative))
  if (!attrs.isDirectory()) throw new AppError('E_INVALID_INPUT', '目标不是目录')
  return readDirectoryNodes(sftp, root, relative, request.depth, {
    remaining: FS_LIMITS.maxTreeEntries
  })
}

export async function readRemoteFile(
  sftp: Sftp,
  root: string,
  request: FsReadFileRequest,
  timeline?: TimelineService,
  workspaceLabel?: string
): Promise<FsReadFileResult> {
  const relative = request.relativePath.replace(/^\/+/, '')
  const absolute = joinRemotePath(root, relative)
  const attrs = await statRemote(sftp, absolute)
  if (attrs.isDirectory()) throw new AppError('E_INVALID_INPUT', '目标不是文件')

  const limit = FS_LIMITS.maxFileBytes
  if (attrs.size > limit * 4) {
    // 超大文件先截断读取，避免一次性拉爆内存
  }
  const raw = await readFileBuffer(sftp, absolute)
  const buffer = raw.length > limit ? raw.subarray(0, limit) : raw
  const truncated = raw.length > limit

  const extension = relative.split('.').pop()?.toLowerCase() ?? ''
  const mime = IMAGE_MIME[extension]
  if (mime) {
    const base64 = buffer.toString('base64')
    return {
      relativePath: relative,
      content: '',
      truncated,
      size: attrs.size,
      contentHash: hashContent(base64),
      eol: 'lf',
      kind: 'image',
      imageDataUrl: `data:${mime};base64,${base64}`
    }
  }

  if (buffer.includes(0)) throw new AppError('E_UNSUPPORTED', '不支持预览二进制文件')

  const normalized = normalizeEol(buffer.toString('utf8'))
  const contentHash = hashContent(normalized.content)
  if (timeline && workspaceLabel && request.expectedHash && request.expectedHash !== contentHash) {
    await timeline.snapshot({
      workspaceRoot: workspaceLabel,
      relativePath: relative,
      source: 'external',
      content: normalized.content
    })
  }
  return {
    relativePath: relative,
    content: normalized.content,
    truncated,
    size: attrs.size,
    contentHash,
    eol: normalized.eol,
    kind: 'text'
  }
}

export async function writeRemoteFile(
  sftp: Sftp,
  root: string,
  request: FsWriteFileRequest,
  timeline?: TimelineService,
  workspaceLabel?: string
): Promise<FsWriteFileResult> {
  const normalized = normalizeEol(request.content)
  const eol = request.eol ?? 'lf'
  const written = applyEol(normalized.content, eol)
  const version: FsFileVersion = {
    content: normalized.content,
    contentHash: hashContent(normalized.content),
    eol,
    size: Buffer.byteLength(written, 'utf8')
  }

  if (request.targetPath) {
    const target = request.targetPath.replace(/^\/+/, '')
    const absolute = joinRemotePath(root, target)
    if (await exists(sftp, absolute)) {
      throw new AppError('E_EXISTS', `已存在同名文件：${splitRelative(target).name}`)
    }
    await writeFileBuffer(sftp, absolute, written)
    if (timeline && workspaceLabel) {
      await timeline.snapshot({
        workspaceRoot: workspaceLabel,
        relativePath: target,
        source: 'user',
        content: normalized.content
      })
    }
    return { status: 'saved', relativePath: target, version }
  }

  const relative = request.relativePath.replace(/^\/+/, '')
  const absolute = joinRemotePath(root, relative)
  const attrs = await statRemote(sftp, absolute)
  if (attrs.isDirectory()) throw new AppError('E_INVALID_INPUT', '目标不是文件')

  const diskRaw = await readFileBuffer(sftp, absolute)
  if (diskRaw.includes(0)) throw new AppError('E_UNSUPPORTED', '不支持保存二进制文件')
  const disk = normalizeEol(diskRaw.toString('utf8'))
  const diskVersion: FsFileVersion = {
    content: disk.content,
    contentHash: hashContent(disk.content),
    eol: disk.eol,
    size: attrs.size
  }

  if (request.expectedHash && request.expectedHash !== diskVersion.contentHash && !request.force) {
    return { status: 'conflict', relativePath: relative, disk: diskVersion }
  }

  await writeFileBuffer(sftp, absolute, written)
  if (timeline && workspaceLabel) {
    await timeline.snapshot({
      workspaceRoot: workspaceLabel,
      relativePath: relative,
      source: 'user',
      content: normalized.content
    })
  }
  return { status: 'saved', relativePath: relative, version }
}

export async function createRemoteEntry(
  sftp: Sftp,
  root: string,
  request: FsCreateEntryRequest,
  type: 'file' | 'directory'
): Promise<FsTreeNode> {
  assertValidEntryName(request.name)
  const parent = request.parentPath.replace(/^\/+/, '')
  const parentAttrs = await statRemote(sftp, joinRemotePath(root, parent))
  if (!parentAttrs.isDirectory()) throw new AppError('E_INVALID_INPUT', '父路径不是目录')
  const relativePath = joinRelative(parent, request.name)
  const absolute = joinRemotePath(root, relativePath)
  if (await exists(sftp, absolute)) {
    throw new AppError('E_EXISTS', `已存在同名条目：${request.name}`)
  }
  if (type === 'directory') {
    await mkdirRemote(sftp, absolute)
  } else {
    await writeFileBuffer(sftp, absolute, '')
  }
  return { name: request.name, relativePath, type }
}

export async function renameRemoteEntry(
  sftp: Sftp,
  root: string,
  request: FsRenameRequest
): Promise<FsTreeNode> {
  assertValidEntryName(request.newName)
  const relative = request.relativePath.replace(/^\/+/, '')
  if (!relative) throw new AppError('E_INVALID_INPUT', '不能重命名工作区根目录')
  const { parent } = splitRelative(relative)
  const target = joinRelative(parent, request.newName)
  const targetAbsolute = joinRemotePath(root, target)
  if (await exists(sftp, targetAbsolute)) {
    throw new AppError('E_EXISTS', `已存在同名条目：${request.newName}`)
  }
  await renameRemote(sftp, joinRemotePath(root, relative), targetAbsolute)
  const attrs = await statRemote(sftp, targetAbsolute)
  return {
    name: request.newName,
    relativePath: target,
    type: attrs.isDirectory() ? 'directory' : 'file'
  }
}

async function resolveTransferTarget(
  sftp: Sftp,
  root: string,
  relativePath: string,
  conflict: FsConflictResolution
): Promise<{ relativePath: string; skip: boolean }> {
  if (!(await exists(sftp, joinRemotePath(root, relativePath)))) {
    return { relativePath, skip: false }
  }
  switch (conflict) {
    case 'error':
      throw new AppError('E_EXISTS', `目标已存在：${splitRelative(relativePath).name}`)
    case 'skip':
      return { relativePath, skip: true }
    case 'replace':
      await removeTree(sftp, root, relativePath)
      return { relativePath, skip: false }
    case 'keep-both':
      return { relativePath: await freeName(sftp, root, relativePath), skip: false }
  }
}

async function transferRemoteEntry(
  sftp: Sftp,
  root: string,
  request: FsTransferRequest,
  mode: 'copy' | 'move'
): Promise<FsTransferResult> {
  const source = request.sourcePath.replace(/^\/+/, '')
  if (!source)
    throw new AppError('E_INVALID_INPUT', `不能${mode === 'copy' ? '复制' : '移动'}工作区根目录`)
  const targetDir = request.targetDir.replace(/^\/+/, '')
  const sourceAttrs = await statRemote(sftp, joinRemotePath(root, source))
  if (sourceAttrs.isDirectory()) {
    const targetDirAbsolute = joinRemotePath(root, targetDir)
    if (
      targetDirAbsolute === joinRemotePath(root, source) ||
      targetDirAbsolute.startsWith(`${joinRemotePath(root, source)}/`)
    ) {
      throw new AppError(
        'E_INVALID_INPUT',
        `不能将目录${mode === 'copy' ? '复制' : '移动'}到自身或子目录`
      )
    }
  }

  const initialTarget = joinRelative(targetDir, splitRelative(source).name)
  const resolved = await resolveTransferTarget(sftp, root, initialTarget, request.conflict)
  if (resolved.skip) return { relativePath: resolved.relativePath, skipped: true }
  if (resolved.relativePath === source) return { relativePath: source, skipped: false }

  if (mode === 'move') {
    await renameRemote(
      sftp,
      joinRemotePath(root, source),
      joinRemotePath(root, resolved.relativePath)
    )
  } else if (sourceAttrs.isDirectory()) {
    await copyDirectory(sftp, root, source, resolved.relativePath)
  } else {
    await copyFile(sftp, root, source, resolved.relativePath)
  }
  return { relativePath: resolved.relativePath, skipped: false }
}

export function copyRemoteEntry(
  sftp: Sftp,
  root: string,
  request: FsTransferRequest
): Promise<FsTransferResult> {
  return transferRemoteEntry(sftp, root, request, 'copy')
}

export function moveRemoteEntry(
  sftp: Sftp,
  root: string,
  request: FsTransferRequest
): Promise<FsTransferResult> {
  return transferRemoteEntry(sftp, root, request, 'move')
}

export async function deleteRemoteEntry(
  sftp: Sftp,
  root: string,
  relativePath: string
): Promise<{ deleted: boolean }> {
  const relative = relativePath.replace(/^\/+/, '')
  if (!relative) throw new AppError('E_INVALID_INPUT', '不能删除工作区根目录')
  await removeTree(sftp, root, relative)
  return { deleted: true }
}
