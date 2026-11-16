import { mkdir, open, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { FS_LIMITS, type FileEol } from '../../shared/ipc'
import { AppError } from '../../shared/errors'
import type { WorkspacePathGuard } from '../workspace/pathGuard'
import { hashContent, normalizeEol, applyEol } from '../workspace/searchCore'

export interface ToolFileContent {
  relativePath: string
  content: string
  size: number
  truncated: boolean
  contentHash: string
  eol: FileEol
}

export interface ToolFileWriteOptions {
  /** 读取时的内容 hash：磁盘内容已变化则拒绝写入，避免覆盖别人的修改 */
  expectedHash?: string
  /** 原文件换行符：写入时还原，避免把 CRLF 文件整体改成 LF 产生整文件 diff */
  eol?: FileEol
}

/**
 * Agent 工具访问文件的唯一入口。
 *
 * 工具实现只依赖这个接口，不直接 import `node:fs`：后续接入 SSH 远程工作区时，
 * 只需在这里补一个基于 SFTP 的实现（`remoteFs.readRemoteFile` / `writeRemoteFile`），
 * 读取分页、补丁匹配等逻辑无需改动。
 */
export interface ToolFileIo {
  read(relativePath: string): Promise<ToolFileContent>
  write(relativePath: string, content: string, options?: ToolFileWriteOptions): Promise<void>
  /** 只读探测：用于搜索结果补上下文行，失败时返回 null 而不是抛错 */
  peek(relativePath: string): Promise<string | null>
}

export interface ToolFileIoDeps {
  requireGuard: () => WorkspacePathGuard
}

export async function readTextFile(
  guard: WorkspacePathGuard,
  relativePath: string
): Promise<ToolFileContent> {
  const resolved = await guard.resolve(relativePath, { mustExist: true })
  const info = await stat(resolved.absolutePath)
  if (!info.isFile()) throw new AppError('E_INVALID_INPUT', '目标不是文件')

  // 只读前 2MB：日志/打包产物这类大文件不能整体读进内存
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
    throw new AppError('E_UNSUPPORTED', '不支持读取二进制文件')
  }

  const normalized = normalizeEol(buffer.toString('utf8'))
  return {
    relativePath: resolved.relativePath,
    content: normalized.content,
    size: info.size,
    truncated: info.size > limit,
    contentHash: hashContent(normalized.content),
    eol: normalized.eol
  }
}

export function createLocalToolFileIo(deps: ToolFileIoDeps): ToolFileIo {
  return {
    async read(relativePath) {
      return readTextFile(deps.requireGuard(), relativePath)
    },

    async write(relativePath, content, options = {}) {
      const guard = deps.requireGuard()
      const normalized = normalizeEol(content)
      const payload = options.eol ? applyEol(normalized.content, options.eol) : normalized.content

      let resolved: { absolutePath: string; relativePath: string } | null = null
      try {
        resolved = await guard.resolve(relativePath, { mustExist: true })
      } catch (error) {
        // 文件不存在 = 新建；其余错误（越界等）原样抛出
        if (!(error instanceof AppError) || error.code !== 'E_NOT_FOUND') throw error
      }

      if (!resolved) {
        const target = await guard.resolveForCreate(relativePath)
        await mkdir(path.dirname(target.absolutePath), { recursive: true })
        await writeFile(target.absolutePath, payload, 'utf8')
        return
      }

      if (options.expectedHash) {
        const current = await readTextFile(guard, resolved.relativePath)
        if (current.contentHash !== options.expectedHash) {
          throw new AppError('E_CONFLICT', '文件在读取后被修改过，请重新读取后再编辑')
        }
      }
      await writeFile(resolved.absolutePath, payload, 'utf8')
    },

    async peek(relativePath) {
      try {
        const file = await readTextFile(deps.requireGuard(), relativePath)
        return file.content
      } catch {
        return null
      }
    }
  }
}
