import { spawn } from 'node:child_process'
import { REMOTE_LIMITS } from '../../shared/remote'
import {
  buildWslArgs,
  decodeWslOutput,
  normalizeRemoteRoot,
  parseWslDistroList,
  parseWslUncPath,
  toWslUncPath
} from './command'
import type {
  RemoteExec,
  RemoteExecOptions,
  RemoteRunResult,
  RemoteSpawnHandle,
  RemoteSpawnOptions,
  RemoteStreamHandle,
  RemoteStreamOptions
} from './execRegistry'

/**
 * WSL 执行层。
 *
 * 文件访问直接用 Windows 侧的 UNC 路径（`\\wsl.localhost\<distro>\...`），
 * 所以文件树/编辑器/时间线可以复用本地实现；只有 Git、搜索、任务这类
 * 必须在 Linux 侧跑的工具才经过 `wsl.exe`。
 */

export function wslExecutable(): string {
  return process.env['YOCIM_WSL_BIN'] ?? 'wsl.exe'
}

export function isWslSupported(): boolean {
  return process.platform === 'win32'
}

function spawnWsl(args: string[]): ReturnType<typeof spawn> {
  return spawn(wslExecutable(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

export interface WslProbeResult {
  available: boolean
  distros: string[]
  defaultDistro?: string
  version?: string
  error?: string
}

/** 探测 `wsl.exe --version` 与发行版列表 */
export async function probeWsl(timeoutMs = REMOTE_LIMITS.probeTimeoutMs): Promise<WslProbeResult> {
  if (!isWslSupported()) {
    return { available: false, distros: [], error: '仅 Windows 支持 WSL 远程工作区' }
  }

  const collect = (
    args: string[]
  ): Promise<{ code: number | null; stdout: Buffer; stderr: Buffer; spawnError?: string }> =>
    new Promise((resolve) => {
      let child
      try {
        child = spawnWsl(args)
      } catch (error) {
        resolve({
          code: null,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          spawnError: error instanceof Error ? error.message : 'wsl.exe 启动失败'
        })
        return
      }
      const out: Buffer[] = []
      const err: Buffer[] = []
      const timer = setTimeout(() => child.kill(), timeoutMs)
      child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
      child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({
          code: null,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          spawnError: error.message
        })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err) })
      })
    })

  const version = await collect(['--version'])
  const listed = await collect(['-l', '-q'])

  if (listed.spawnError) {
    return {
      available: false,
      distros: [],
      error: `无法调用 wsl.exe：${listed.spawnError}`
    }
  }

  const distros = parseWslDistroList(decodeWslOutput(listed.stdout))
  if (!distros.length) {
    const detail = decodeWslOutput(listed.stderr).trim()
    return {
      available: false,
      distros: [],
      error:
        detail ||
        (version.code === 0
          ? '未安装任何 WSL 发行版，请先在终端执行 wsl --install'
          : '未检测到 WSL，请先启用「适用于 Linux 的 Windows 子系统」')
    }
  }

  const versionText = decodeWslOutput(version.stdout).trim()
  return {
    available: true,
    distros,
    ...(versionText ? { version: versionText.split(/\r?\n/)[0]?.trim() } : {}),
    ...(distros[0] ? { defaultDistro: distros[0] } : {})
  }
}

interface WslExecOptions {
  distro: string
  rootPath: string
}

export function createWslExec(options: WslExecOptions): RemoteExec {
  const rootPath = normalizeRemoteRoot(options.rootPath)
  const localRoot = toWslUncPath(options.distro, rootPath)
  const label = `WSL · ${options.distro}`

  const run = (
    command: string,
    args: string[],
    runOptions: RemoteExecOptions = {}
  ): Promise<RemoteRunResult> =>
    new Promise((resolve) => {
      const cwd = runOptions.cwd ?? rootPath
      let child
      try {
        child = spawnWsl(buildWslArgs({ distro: options.distro, cwd, command, args }))
      } catch (error) {
        resolve({
          code: null,
          stdout: '',
          stderr: '',
          spawnError: error instanceof Error ? error.message : 'wsl.exe 启动失败'
        })
        return
      }

      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, runOptions.timeoutMs ?? REMOTE_LIMITS.execTimeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < 4 * 1024 * 1024) stdout += chunk.toString('utf8')
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8000)
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ code: null, stdout, stderr, spawnError: error.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code, stdout, stderr, ...(timedOut ? { timedOut: true } : {}) })
      })
    })

  const stream = (
    command: string,
    args: string[],
    streamOptions: RemoteStreamOptions
  ): RemoteStreamHandle => {
    const cwd = streamOptions.cwd ?? rootPath
    let child: ReturnType<typeof spawn>
    try {
      child = spawnWsl(buildWslArgs({ distro: options.distro, cwd, command, args }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'wsl.exe 启动失败'
      return { cancel: () => {}, done: Promise.resolve({ code: null, stderr: message }) }
    }

    let stderr = ''
    let buffer = ''
    const timer = setTimeout(
      () => child.kill(),
      streamOptions.timeoutMs ?? REMOTE_LIMITS.execTimeoutMs
    )

    const flush = (chunk: string, final: boolean): void => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = final ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        if (line.trim()) streamOptions.onLine(line)
      }
      if (final && buffer.trim()) streamOptions.onLine(buffer)
    }

    child.stdout?.on('data', (chunk: Buffer) => flush(chunk.toString('utf8'), false))
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8000)
      streamOptions.onStderr?.(chunk.toString('utf8'))
    })

    const done = new Promise<{ code: number | null; stderr: string }>((resolve) => {
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ code: null, stderr: error.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        flush('', true)
        resolve({ code, stderr })
      })
    })

    return { cancel: () => child.kill(), done }
  }

  const spawnTask = (
    command: string,
    args: string[],
    spawnOptions: RemoteSpawnOptions
  ): RemoteSpawnHandle => {
    const cwd = spawnOptions.cwd ?? rootPath
    let child: ReturnType<typeof spawn>
    try {
      child = spawnWsl(buildWslArgs({ distro: options.distro, cwd, command, args }))
    } catch (error) {
      spawnOptions.onExit(null, error instanceof Error ? error.message : 'wsl.exe 启动失败')
      return { kill: () => {} }
    }
    let settled = false
    child.stdout?.on('data', (chunk: Buffer) => spawnOptions.onStdout(chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => spawnOptions.onStderr(chunk.toString('utf8')))
    child.on('error', (error) => {
      if (settled) return
      settled = true
      spawnOptions.onExit(null, error.message)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      spawnOptions.onExit(code)
    })
    return {
      kill: () => {
        child.kill()
      }
    }
  }

  const toRemotePath = (localPath: string | null | undefined): string | null => {
    if (!localPath) return null
    const parsed = parseWslUncPath(localPath)
    if (parsed && parsed.distro.toLowerCase() === options.distro.toLowerCase())
      return parsed.linuxPath
    return null
  }

  return { kind: 'wsl', label, rootPath, localRoot, run, stream, spawn: spawnTask, toRemotePath }
}
