import { AppError } from '../../shared/errors'

/**
 * WSL / SSH 命令构造与路径映射。
 * 这里刻意做成纯函数，便于单测覆盖（WSL 在 CI/沙箱里通常不可用）。
 */

/** `wsl.exe -l -q` 输出是 UTF-16LE（带 BOM），而 `--version` 可能是 UTF-8，按内容判断 */
export function decodeWslOutput(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  // 大量奇数位为 0 的字节说明是 UTF-16LE 文本（ASCII + 中文混排都会命中）
  let zeroAtOdd = 0
  const sample = Math.min(buffer.length, 256)
  for (let index = 1; index < sample; index += 2) {
    if (buffer[index] === 0) zeroAtOdd += 1
  }
  if (sample >= 8 && zeroAtOdd >= (sample / 2) * 0.6) {
    return buffer.toString('utf16le')
  }
  return buffer.toString('utf8')
}

export function parseWslDistroList(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\0/g, ''))
    .filter((line) => line.length > 0 && !/^windows subsystem/i.test(line))
}

/** 统一远端根路径写法：必须以 `/` 开头，去掉结尾多余的 `/`（根目录本身除外） */
export function normalizeRemoteRoot(linuxPath: string): string {
  const trimmed = linuxPath.trim()
  if (!trimmed) throw new AppError('E_INVALID_INPUT', '远端路径不能为空')
  if (trimmed.startsWith('~')) {
    throw new AppError(
      'E_INVALID_INPUT',
      '远端路径请使用绝对路径（例如 /home/me/project），不要用 ~'
    )
  }
  if (!trimmed.startsWith('/')) {
    throw new AppError('E_INVALID_INPUT', '远端路径必须是绝对路径（以 / 开头）')
  }
  const collapsed = `/${trimmed
    .split('/')
    .filter((segment) => segment.length > 0)
    .join('/')}`
  return collapsed === '/' ? '/' : collapsed
}

export function wslUncRoot(): string {
  // Win10 1903+ / Win11 都支持 \\wsl.localhost；老环境可回退 \\wsl$
  const override = process.env['YOCIM_WSL_UNC_ROOT']
  if (override) return override.replace(/\\+$/, '')
  return '\\\\wsl.localhost'
}

/** WSL 工作区在 Windows 侧的 UNC 根路径，例如 `\\wsl.localhost\Ubuntu\home\me\project` */
export function toWslUncPath(distro: string, linuxPath: string): string {
  const normalized = normalizeRemoteRoot(linuxPath)
  const suffix = normalized.split('/').filter(Boolean).join('\\')
  const base = `${wslUncRoot()}\\${distro}`
  return suffix ? `${base}\\${suffix}` : base
}

const WSL_UNC_PATTERN = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(?:\\(.*))?$/i

export function parseWslUncPath(uncPath: string): { distro: string; linuxPath: string } | null {
  const match = WSL_UNC_PATTERN.exec(uncPath)
  if (!match) return null
  const distro = match[1] ?? ''
  const rest = (match[2] ?? '').split('\\').filter(Boolean).join('/')
  return { distro, linuxPath: rest ? `/${rest}` : '/' }
}

export function isWslUncPath(value: string): boolean {
  return WSL_UNC_PATTERN.test(value)
}

/** POSIX 单引号转义；远程命令与 `--exec` 之外的 shell 场景都需要 */
export function shellQuote(value: string): string {
  if (value === '') return "''"
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildRemoteCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(' ')
}

export interface WslInvocation {
  distro: string
  /** 远端工作目录（Linux 路径），省略则用发行版默认目录 */
  cwd?: string
  command: string
  args: string[]
}

/**
 * `wsl.exe -d <distro> --cd <dir> --exec <cmd> ...`
 * `--exec` 不经过 shell，参数按数组传递，避免注入；`--cd` 要求 WSL 1903+。
 */
export function buildWslArgs(invocation: WslInvocation): string[] {
  const args = ['-d', invocation.distro]
  if (invocation.cwd) {
    args.push('--cd', normalizeRemoteRoot(invocation.cwd))
  }
  args.push('--exec', invocation.command, ...invocation.args)
  return args
}

export interface SshInvocation {
  host: string
  port?: number
  username?: string
  /** 远端命令行（已转义） */
  command: string
  cwd?: string
}

/** 系统 OpenSSH 的等价参数（探测/兜底用；文件与 SFTP 走 ssh2） */
export function buildSshArgs(invocation: SshInvocation): string[] {
  const target = invocation.username ? `${invocation.username}@${invocation.host}` : invocation.host
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes']
  if (invocation.port && invocation.port !== 22) args.push('-p', String(invocation.port))
  args.push(target)
  const command = invocation.cwd
    ? `cd ${shellQuote(normalizeRemoteRoot(invocation.cwd))} && ${invocation.command}`
    : invocation.command
  args.push(command)
  return args
}

/** 远端相对路径 → 绝对路径；同时做基础校验（不允许 .. 穿越） */
export function joinRemotePath(root: string, relativePath: string): string {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!clean || clean === '.') return root
  const segments = clean.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.includes('..')) {
    throw new AppError('E_PATH_ESCAPE', '路径不允许包含上级目录')
  }
  return `${root === '/' ? '' : root}/${segments.join('/')}`
}
