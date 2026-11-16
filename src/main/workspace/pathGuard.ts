import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../../shared/errors'

export interface ResolvedWorkspacePath {
  absolutePath: string
  relativePath: string
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  const escapes =
    relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  return !escapes
}

export function normalizeWorkspaceRelativePath(input: string): string {
  if (input.includes('\0')) {
    throw new AppError('E_INVALID_INPUT', '路径包含非法字符')
  }
  if (/^[a-zA-Z]:/.test(input) || path.isAbsolute(input)) {
    throw new AppError('E_PATH_ESCAPE', '不允许使用绝对路径')
  }
  if (input.startsWith('\\\\') || input.startsWith('//')) {
    throw new AppError('E_PATH_ESCAPE', '不允许使用网络路径')
  }

  const segments = input.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.')
  if (segments.includes('..')) {
    throw new AppError('E_PATH_ESCAPE', '路径不允许包含上级目录')
  }
  // IPC / 工具层统一使用正斜杠相对路径，避免 Windows 反斜杠泄漏到 UI 与日志
  return segments.join('/')
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}

export class WorkspacePathGuard {
  private readonly rootPath: string

  private constructor(rootPath: string) {
    this.rootPath = rootPath
  }

  static async create(root: string): Promise<WorkspacePathGuard> {
    const resolved = await realpath(path.resolve(root))
    return new WorkspacePathGuard(resolved)
  }

  get root(): string {
    return this.rootPath
  }

  /**
   * 将工作区相对路径解析为真实绝对路径。
   * 所有文件系统入口必须先经过本方法，禁止直接拼接路径。
   */
  async resolve(
    relativePath: string,
    options: { mustExist?: boolean } = {}
  ): Promise<ResolvedWorkspacePath> {
    const normalized = normalizeWorkspaceRelativePath(relativePath)
    const candidate = normalized ? path.join(this.rootPath, normalized) : this.rootPath
    if (!isInsideRoot(this.rootPath, candidate)) {
      throw new AppError('E_PATH_ESCAPE', '路径超出工作区范围')
    }

    const mustExist = options.mustExist ?? true
    let real: string
    try {
      real = await realpath(candidate)
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw new AppError('E_IO', '读取路径失败')
      }
      if (mustExist) {
        throw new AppError('E_NOT_FOUND', `路径不存在：${normalized || '.'}`)
      }
      const parent = path.dirname(candidate)
      let realParent: string
      try {
        realParent = await realpath(parent)
      } catch {
        throw new AppError('E_NOT_FOUND', '父目录不存在')
      }
      real = path.join(realParent, path.basename(candidate))
    }

    if (!isInsideRoot(this.rootPath, real)) {
      throw new AppError('E_PATH_ESCAPE', '符号链接指向工作区之外')
    }

    return { absolutePath: real, relativePath: normalized || '.' }
  }

  /**
   * 解析“可能要新建”的路径：目标不存在时，找到最近的已存在父目录做 realpath 校验，
   * 再把剩余不存在的子路径拼回去，避免新建目录时被误判为不存在。
   */
  async resolveForCreate(relativePath: string): Promise<ResolvedWorkspacePath> {
    const normalized = normalizeWorkspaceRelativePath(relativePath)
    if (!normalized) {
      throw new AppError('E_INVALID_INPUT', '写入路径不能为空')
    }
    const candidate = path.join(this.rootPath, normalized)
    if (!isInsideRoot(this.rootPath, candidate)) {
      throw new AppError('E_PATH_ESCAPE', '路径超出工作区范围')
    }

    try {
      const real = await realpath(candidate)
      if (!isInsideRoot(this.rootPath, real)) {
        throw new AppError('E_PATH_ESCAPE', '符号链接指向工作区之外')
      }
      return { absolutePath: real, relativePath: normalized }
    } catch (error) {
      if (error instanceof AppError) throw error
      if (!isNotFoundError(error)) {
        throw new AppError('E_IO', '读取路径失败')
      }
    }

    let ancestor = path.dirname(candidate)
    while (isInsideRoot(this.rootPath, ancestor)) {
      try {
        const realAncestor = await realpath(ancestor)
        if (!isInsideRoot(this.rootPath, realAncestor)) {
          throw new AppError('E_PATH_ESCAPE', '符号链接指向工作区之外')
        }
        const suffix = path.relative(ancestor, candidate)
        return {
          absolutePath: path.join(realAncestor, suffix),
          relativePath: normalized
        }
      } catch (error) {
        if (error instanceof AppError) throw error
        if (!isNotFoundError(error)) {
          throw new AppError('E_IO', '解析路径失败')
        }
      }

      if (ancestor === this.rootPath) break
      const parent = path.dirname(ancestor)
      if (parent === ancestor) break
      ancestor = parent
    }

    throw new AppError('E_NOT_FOUND', '无法确定工作区内的写入位置')
  }
}

/**
 * Git / 搜索只依赖 `root` 与 `resolve`，远程（SSH）工作区没有本地路径，
 * 用这个最小接口让它们复用同一套调用。
 */
export interface WorkspaceGuardLike {
  root: string
  resolve: (
    relativePath: string,
    options?: { mustExist?: boolean }
  ) => Promise<ResolvedWorkspacePath>
}

/**
 * SSH 远程工作区的“虚拟守卫”：只做相对路径规范化，不触碰本地文件系统。
 * 真实文件读写由 remoteFs（SFTP）负责，不要把它传给本地 fs 调用。
 */
export class RemotePathGuard implements WorkspaceGuardLike {
  private readonly rootLabel: string
  private readonly placeholder: string

  constructor(rootLabel: string, placeholder = '.yocim-remote') {
    this.rootLabel = rootLabel
    this.placeholder = placeholder
  }

  get root(): string {
    return `${this.placeholder}/${this.rootLabel}`
  }

  async resolve(relativePath: string): Promise<ResolvedWorkspacePath> {
    const normalized = normalizeWorkspaceRelativePath(relativePath)
    return {
      absolutePath: normalized ? `${this.root}/${normalized}` : this.root,
      relativePath: normalized || '.'
    }
  }

  async resolveForCreate(relativePath: string): Promise<ResolvedWorkspacePath> {
    if (!normalizeWorkspaceRelativePath(relativePath)) {
      throw new AppError('E_INVALID_INPUT', '写入路径不能为空')
    }
    return this.resolve(relativePath)
  }
}
