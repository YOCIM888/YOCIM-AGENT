import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ToolExecutionOutcome } from '../../shared/agent'
import { AppError } from '../../shared/errors'
import { IGNORED_DIRECTORIES } from '../../shared/ipcChannels'
import { readWorkspaceFile, readWorkspaceTree } from '../workspace/workspaceFs'
import type { WorkspacePathGuard } from '../workspace/pathGuard'
import type { ListDirArgs, ReadFileArgs, SearchFilesArgs, WriteFileArgs } from './toolSchemas'

const SEARCH_FILE_SIZE_LIMIT = 512 * 1024
const SEARCH_FILE_COUNT_LIMIT = 2000

export async function runListDir(
  guard: WorkspacePathGuard,
  args: ListDirArgs
): Promise<ToolExecutionOutcome> {
  const nodes = await readWorkspaceTree(guard, {
    relativePath: args.relativePath,
    depth: args.depth
  })
  const lines: string[] = []
  const walk = (items: typeof nodes, indent: number): void => {
    for (const node of items) {
      lines.push(`${'  '.repeat(indent)}${node.type === 'directory' ? `${node.name}/` : node.name}`)
      if (node.children) walk(node.children, indent + 1)
    }
  }
  walk(nodes, 0)

  return {
    ok: true,
    content: lines.length ? lines.join('\n') : '（空目录）',
    summary: `${args.relativePath || '.'}：${lines.length} 个条目`
  }
}

export async function runReadFile(
  guard: WorkspacePathGuard,
  args: ReadFileArgs
): Promise<ToolExecutionOutcome> {
  const result = await readWorkspaceFile(guard, { relativePath: args.relativePath })
  return {
    ok: true,
    content: result.truncated
      ? `${result.content}\n\n[文件已截断，原始大小 ${result.size} 字节]`
      : result.content,
    summary: `${result.relativePath}（${result.size} 字节${result.truncated ? '，已截断' : ''}）`
  }
}

export async function runSearchFiles(
  guard: WorkspacePathGuard,
  args: SearchFilesArgs
): Promise<ToolExecutionOutcome> {
  const start = await guard.resolve(args.relativePath, { mustExist: true })
  const startInfo = await stat(start.absolutePath)
  if (!startInfo.isDirectory()) {
    throw new AppError('E_INVALID_INPUT', '搜索起点不是目录')
  }

  const results: string[] = []
  const scanned = { files: 0 }
  const lowerQuery = args.query.toLowerCase()

  const walk = async (absoluteDir: string, relativeDir: string): Promise<void> => {
    if (results.length >= args.maxResults || scanned.files >= SEARCH_FILE_COUNT_LIMIT) return

    let entries
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= args.maxResults || scanned.files >= SEARCH_FILE_COUNT_LIMIT) return
      if (IGNORED_DIRECTORIES.has(entry.name)) continue

      const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      const childAbsolute = path.join(absoluteDir, entry.name)

      if (entry.isDirectory()) {
        await walk(childAbsolute, childRelative)
        continue
      }
      if (!entry.isFile()) continue

      scanned.files += 1
      try {
        const fileInfo = await stat(childAbsolute)
        if (fileInfo.size > SEARCH_FILE_SIZE_LIMIT) continue
        const buffer = await readFile(childAbsolute)
        if (buffer.includes(0)) continue
        const lines = buffer.toString('utf8').split(/\r?\n/)
        for (let index = 0; index < lines.length; index += 1) {
          if (lines[index].toLowerCase().includes(lowerQuery)) {
            results.push(`${childRelative}:${index + 1}: ${lines[index].trim().slice(0, 200)}`)
            if (results.length >= args.maxResults) return
          }
        }
      } catch {
        continue
      }
    }
  }

  const startRelative = start.relativePath === '.' ? '' : start.relativePath
  await walk(start.absolutePath, startRelative)

  return {
    ok: true,
    content: results.length ? results.join('\n') : '未找到匹配项。',
    summary: `搜索「${args.query}」：${results.length} 条结果（扫描 ${scanned.files} 个文件）`
  }
}

export function assertWritableRelativePath(relativePath: string): void {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean)
  for (const segment of segments) {
    if (IGNORED_DIRECTORIES.has(segment)) {
      throw new AppError('E_TOOL_DENIED', `禁止写入忽略目录：${segment}`)
    }
  }
}

export async function runWriteFile(
  guard: WorkspacePathGuard,
  args: WriteFileArgs
): Promise<ToolExecutionOutcome> {
  assertWritableRelativePath(args.relativePath)
  const target = await guard.resolveForCreate(args.relativePath)

  if (typeof args.oldText === 'string' && typeof args.newText === 'string') {
    let before: string
    try {
      before = await readFile(target.absolutePath, 'utf8')
    } catch {
      throw new AppError('E_NOT_FOUND', `文件不存在：${target.relativePath}`)
    }
    const occurrences = before.split(args.oldText).length - 1
    if (occurrences !== 1) {
      throw new AppError('E_INVALID_INPUT', `补丁原文匹配 ${occurrences} 次，必须且只能匹配 1 次`)
    }
    await writeFile(target.absolutePath, before.replace(args.oldText, args.newText), 'utf8')
    return {
      ok: true,
      content: `已更新 ${target.relativePath}`,
      summary: `补丁 ${target.relativePath}（替换 1 处）`
    }
  }

  const content = args.content ?? ''
  await mkdir(path.dirname(target.absolutePath), { recursive: true })
  await writeFile(target.absolutePath, content, 'utf8')
  return {
    ok: true,
    content: `已写入 ${target.relativePath}（${Buffer.byteLength(content)} 字节）`,
    summary: `写入 ${target.relativePath}（${Buffer.byteLength(content)} 字节）`
  }
}
