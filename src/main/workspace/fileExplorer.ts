import { copyFile, lstat, mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import type {
  FsConflictResolution,
  FsCreateEntryRequest,
  FsRenameRequest,
  FsTransferRequest,
  FsTransferResult,
  FsTreeNode
} from '../../shared/ipc'
import { isInsideRoot, type WorkspacePathGuard } from './pathGuard'

export type TrashItem = (absolutePath: string) => Promise<void>

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|\0]/

export function assertValidEntryName(name: string): void {
  if (!name.trim()) {
    throw new AppError('E_INVALID_INPUT', '名称不能为空')
  }
  if (name === '.' || name === '..') {
    throw new AppError('E_INVALID_INPUT', '名称不合法')
  }
  if (ILLEGAL_NAME_CHARS.test(name)) {
    throw new AppError('E_INVALID_INPUT', '名称不能包含 \\ / : * ? " < > | 字符')
  }
  if (/[. ]$/.test(name)) {
    throw new AppError('E_INVALID_INPUT', '名称不能以空格或点结尾')
  }
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath)
    return true
  } catch {
    return false
  }
}

function relativeFromRoot(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/')
}

function joinRelative(parent: string, name: string): string {
  return parent === '.' || parent === '' ? name : `${parent}/${name}`
}

async function toNode(absolutePath: string, relativePath: string): Promise<FsTreeNode> {
  const info = await stat(absolutePath)
  return {
    name: path.basename(absolutePath),
    relativePath,
    type: info.isDirectory() ? 'directory' : 'file'
  }
}

async function resolveTargetDir(guard: WorkspacePathGuard, targetDir: string): Promise<string> {
  const resolved = await guard.resolve(targetDir, { mustExist: true })
  const info = await stat(resolved.absolutePath)
  if (!info.isDirectory()) {
    throw new AppError('E_INVALID_INPUT', '目标位置不是目录')
  }
  return resolved.absolutePath
}

async function freeName(targetAbs: string): Promise<string> {
  const dir = path.dirname(targetAbs)
  const ext = path.extname(targetAbs)
  const stem = path.basename(targetAbs, ext)
  for (let index = 2; index < 1000; index += 1) {
    const candidate = path.join(dir, `${stem} (${index})${ext}`)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new AppError('E_IO', '无法生成不重名的目标名称')
}

async function resolveTransferTarget(
  targetAbs: string,
  conflict: FsConflictResolution
): Promise<{ abs: string; skip: boolean }> {
  if (!(await pathExists(targetAbs))) return { abs: targetAbs, skip: false }
  switch (conflict) {
    case 'error':
      throw new AppError('E_EXISTS', `目标已存在：${path.basename(targetAbs)}`)
    case 'skip':
      return { abs: targetAbs, skip: true }
    case 'replace':
      return { abs: targetAbs, skip: false }
    case 'keep-both':
      return { abs: await freeName(targetAbs), skip: false }
  }
}

async function copyDirRecursive(sourceAbs: string, targetAbs: string): Promise<void> {
  await mkdir(targetAbs, { recursive: true })
  const entries = await readdir(sourceAbs, { withFileTypes: true })
  for (const entry of entries) {
    // 符号链接不复制，避免把链接目标暴露到工作区其他位置
    if (entry.isSymbolicLink()) continue
    const sourceChild = path.join(sourceAbs, entry.name)
    const targetChild = path.join(targetAbs, entry.name)
    if (entry.isDirectory()) {
      await copyDirRecursive(sourceChild, targetChild)
    } else if (entry.isFile()) {
      await copyFile(sourceChild, targetChild)
    }
  }
}

export async function createWorkspaceEntry(
  guard: WorkspacePathGuard,
  request: FsCreateEntryRequest,
  type: 'file' | 'directory'
): Promise<FsTreeNode> {
  assertValidEntryName(request.name)
  const parent = await guard.resolve(request.parentPath, { mustExist: true })
  const parentInfo = await stat(parent.absolutePath)
  if (!parentInfo.isDirectory()) {
    throw new AppError('E_INVALID_INPUT', '父路径不是目录')
  }
  const relativePath = joinRelative(parent.relativePath, request.name)
  const target = await guard.resolveForCreate(relativePath)
  if (await pathExists(target.absolutePath)) {
    throw new AppError('E_EXISTS', `已存在同名条目：${request.name}`)
  }
  if (type === 'directory') {
    await mkdir(target.absolutePath)
  } else {
    await writeFile(target.absolutePath, '', 'utf8')
  }
  return toNode(target.absolutePath, target.relativePath)
}

export async function renameWorkspaceEntry(
  guard: WorkspacePathGuard,
  request: FsRenameRequest
): Promise<FsTreeNode> {
  assertValidEntryName(request.newName)
  const source = await guard.resolve(request.relativePath, { mustExist: true })
  if (source.relativePath === '.') {
    throw new AppError('E_INVALID_INPUT', '不能重命名工作区根目录')
  }
  const separator = source.relativePath.lastIndexOf('/')
  const parent = separator >= 0 ? source.relativePath.slice(0, separator) : ''
  const target = await guard.resolveForCreate(joinRelative(parent, request.newName))
  if (await pathExists(target.absolutePath)) {
    throw new AppError('E_EXISTS', `已存在同名条目：${request.newName}`)
  }
  await rename(source.absolutePath, target.absolutePath)
  return toNode(target.absolutePath, target.relativePath)
}

interface TransferPlan {
  sourceAbs: string
  sourceIsDir: boolean
  targetAbs: string
  targetRelative: string
  skipped: boolean
  sameLocation: boolean
}

async function planTransfer(
  guard: WorkspacePathGuard,
  request: FsTransferRequest,
  action: '复制' | '移动'
): Promise<TransferPlan> {
  const source = await guard.resolve(request.sourcePath, { mustExist: true })
  if (source.relativePath === '.') {
    throw new AppError('E_INVALID_INPUT', `不能${action}工作区根目录`)
  }
  const sourceInfo = await stat(source.absolutePath)
  const targetDirAbs = await resolveTargetDir(guard, request.targetDir)
  // 目标目录位于源目录内部（含自身）会导致递归复制，禁止
  if (sourceInfo.isDirectory() && isInsideRoot(source.absolutePath, targetDirAbs)) {
    throw new AppError('E_INVALID_INPUT', `不能将目录${action}到自身或子目录`)
  }
  const initialTargetAbs = path.join(targetDirAbs, path.basename(source.absolutePath))
  const { abs, skip } = await resolveTransferTarget(initialTargetAbs, request.conflict)
  const target = await guard.resolveForCreate(relativeFromRoot(guard.root, abs))
  return {
    sourceAbs: source.absolutePath,
    sourceIsDir: sourceInfo.isDirectory(),
    targetAbs: target.absolutePath,
    targetRelative: target.relativePath,
    skipped: skip,
    sameLocation: target.absolutePath === source.absolutePath
  }
}

export async function copyWorkspaceEntry(
  guard: WorkspacePathGuard,
  request: FsTransferRequest
): Promise<FsTransferResult> {
  const plan = await planTransfer(guard, request, '复制')
  if (plan.skipped || plan.sameLocation) {
    return { relativePath: plan.targetRelative, skipped: plan.skipped }
  }
  if (plan.sourceIsDir) {
    await copyDirRecursive(plan.sourceAbs, plan.targetAbs)
  } else {
    await copyFile(plan.sourceAbs, plan.targetAbs)
  }
  return { relativePath: plan.targetRelative, skipped: false }
}

export async function moveWorkspaceEntry(
  guard: WorkspacePathGuard,
  request: FsTransferRequest,
  trashItem: TrashItem
): Promise<FsTransferResult> {
  const plan = await planTransfer(guard, request, '移动')
  if (plan.skipped || plan.sameLocation) {
    return { relativePath: plan.targetRelative, skipped: plan.skipped }
  }
  if (request.conflict === 'replace' && (await pathExists(plan.targetAbs))) {
    // 替换已存在目标：先覆盖内容，再把源移入回收站，避免直接永久删除
    if (plan.sourceIsDir) {
      await copyDirRecursive(plan.sourceAbs, plan.targetAbs)
    } else {
      await copyFile(plan.sourceAbs, plan.targetAbs)
    }
    await trashItem(plan.sourceAbs)
  } else {
    await rename(plan.sourceAbs, plan.targetAbs)
  }
  return { relativePath: plan.targetRelative, skipped: false }
}

export async function deleteWorkspaceEntry(
  guard: WorkspacePathGuard,
  relativePath: string,
  trashItem: TrashItem
): Promise<{ deleted: boolean }> {
  const target = await guard.resolve(relativePath, { mustExist: true })
  if (target.relativePath === '.') {
    throw new AppError('E_INVALID_INPUT', '不能删除工作区根目录')
  }
  await trashItem(target.absolutePath)
  return { deleted: true }
}
