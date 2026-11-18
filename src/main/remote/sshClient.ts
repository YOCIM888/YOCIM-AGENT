import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { AppError } from '../../shared/errors'
import { REMOTE_LIMITS, type RemoteAuthType } from '../../shared/remote'
import { buildRemoteCommandLine, joinRemotePath, normalizeRemoteRoot } from './command'
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
 * SSH 执行层（ssh2）。
 *
 * 选择 ssh2 而不是系统 OpenSSH 的原因：需要 SFTP 做文件读写、需要在连接阶段
 * 拿到主机公钥做指纹校验（TOFU），系统 ssh 的 `sftp -b` 无法做这两件事。
 */

/** OpenSSH 风格指纹：`SHA256:<base64 无填充>` */
export function formatHostFingerprint(publicKey: Buffer): string {
  const digest = createHash('sha256').update(publicKey).digest('base64')
  return `SHA256:${digest.replace(/=+$/, '')}`
}

/** 从 SSH 公钥二进制里读出算法名（第一个 length-prefixed 字符串） */
export function readHostKeyType(publicKey: Buffer): string {
  if (publicKey.length < 4) return 'unknown'
  const length = publicKey.readUInt32BE(0)
  if (length <= 0 || 4 + length > publicKey.length) return 'unknown'
  return publicKey.subarray(4, 4 + length).toString('ascii')
}

export interface SshConnectOptions {
  host: string
  port?: number
  username: string
  authType: RemoteAuthType
  keyPath?: string
  secret?: string
  /** 已信任的指纹；为空表示首次连接 */
  expectedFingerprint?: string
  /** 用户已确认信任未知主机 */
  trustUnknownHost?: boolean
  timeoutMs?: number
}

export interface SshConnectResult {
  fingerprint: string
  keyType: string
}

/** 一次主机公钥校验的结果；error 只在需要阻断时设置 */
export interface HostKeyVerification {
  fingerprint: string
  keyType: string
  accepted: boolean
  error: AppError | null
}

/**
 * 决定是否接受主机公钥（TOFU）。
 *
 * 首连或指纹变化时必须阻断握手（认证前），但 ssh2 对 `return false` 只给出
 * 通用的 `Host denied (verification failed)`，真实指纹会丢失，UI 就无法让
 * 用户确认。这里把 E_CONFLICT（含 SHA256 指纹）一并带出，由调用方在握手
 * 失败时原样抛出。
 */
export function verifyHostKey(
  key: Buffer,
  options: Pick<SshConnectOptions, 'expectedFingerprint' | 'trustUnknownHost'>
): HostKeyVerification {
  const fingerprint = formatHostFingerprint(key)
  const keyType = readHostKeyType(key)
  const accept = (): HostKeyVerification => ({
    fingerprint,
    keyType,
    accepted: true,
    error: null
  })
  const deny = (error: AppError): HostKeyVerification => ({
    fingerprint,
    keyType,
    accepted: false,
    error
  })

  // 用户已显式确认信任（首连确认，或指纹变更后的重新信任）
  if (options.trustUnknownHost === true) return accept()

  if (!options.expectedFingerprint) {
    return deny(new AppError('E_CONFLICT', `首次连接需要确认主机指纹：${fingerprint}`))
  }
  if (fingerprint !== options.expectedFingerprint) {
    return deny(
      new AppError(
        'E_CONFLICT',
        `SSH 主机指纹已变化（当前 ${fingerprint}），已阻断连接。如确认是预期变更，请在目标详情中重新信任主机`
      )
    )
  }
  return accept()
}

function mapAuthError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('all configured authentication methods failed')) {
    return 'SSH 认证失败：请检查用户名、私钥/口令或 ssh-agent 是否可用'
  }
  if (lower.includes('cannot parse privatekey') || lower.includes('bad passphrase')) {
    return 'SSH 私钥无法解析：请确认私钥文件与私钥口令'
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'SSH 连接超时：请检查主机地址、端口与网络'
  }
  if (lower.includes('econnrefused')) return 'SSH 连接被拒绝：请确认远端 sshd 已启动且端口正确'
  if (lower.includes('enotfound')) return 'SSH 主机名无法解析：请检查主机地址'
  return `SSH 连接失败：${message}`
}

export class SshClient {
  private readonly client: Client
  private sftpSession: SFTPWrapper | null = null
  private closed = false

  constructor() {
    this.client = new Client()
  }

  async connect(options: SshConnectOptions): Promise<SshConnectResult> {
    // 经对象持有：hostVerifier 是 ssh2 的回调，TS 看不到它的赋值时机，
    // 直接用局部变量会被控制流分析推断成 never。
    const state: { verification: HostKeyVerification | null } = { verification: null }

    const config: ConnectConfig = {
      host: options.host,
      port: options.port ?? 22,
      username: options.username,
      readyTimeout: options.timeoutMs ?? REMOTE_LIMITS.connectTimeoutMs,
      keepaliveInterval: 15_000,
      hostVerifier: (key: Buffer): boolean => {
        state.verification = verifyHostKey(key, options)
        return state.verification.accepted
      }
    }

    if (options.authType === 'password') {
      if (!options.secret) throw new AppError('E_INVALID_INPUT', 'SSH 密码认证需要提供密码')
      config.password = options.secret
    } else if (options.authType === 'key') {
      if (!options.keyPath) throw new AppError('E_INVALID_INPUT', 'SSH 私钥认证需要提供私钥路径')
      const privateKey = await readFile(options.keyPath).catch(() => null)
      if (!privateKey) {
        throw new AppError('E_NOT_FOUND', `无法读取 SSH 私钥：${options.keyPath}`)
      }
      config.privateKey = privateKey
      if (options.secret) config.passphrase = options.secret
    } else {
      const agent = process.env['SSH_AUTH_SOCK']
      if (!agent) {
        throw new AppError(
          'E_UNSUPPORTED',
          '未检测到 ssh-agent（SSH_AUTH_SOCK），请改用私钥或密码认证'
        )
      }
      config.agent = agent
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.client.removeListener('ready', onReady)
        // 指纹校验失败时 ssh2 只报通用的 "Host denied"，换成我们准备好的
        // E_CONFLICT（含真实指纹），remoteService 才能把它交给 UI 确认。
        reject(
          state.verification?.error ?? new AppError('E_UNKNOWN', mapAuthError(error.message))
        )
      }
      const onReady = (): void => {
        this.client.removeListener('error', onError)
        resolve()
      }
      this.client.once('ready', onReady)
      this.client.once('error', onError)
      try {
        this.client.connect(config)
      } catch (error) {
        this.client.removeListener('ready', onReady)
        this.client.removeListener('error', onError)
        reject(
          new AppError(
            'E_UNKNOWN',
            mapAuthError(error instanceof Error ? error.message : '连接失败')
          )
        )
      }
    }).catch((error: unknown) => {
      throw error instanceof AppError ? error : new AppError('E_UNKNOWN', 'SSH 连接失败')
    })

    const verification = state.verification
    if (!verification) {
      throw new AppError('E_UNKNOWN', '未能获取 SSH 主机指纹，已阻断连接')
    }
    // 走到这里握手已被接受；accepted=false 本应在 onError 阶段抛出，
    // 保留这层防御以防 ssh2 未来行为变化时静默放行。
    if (!verification.accepted) {
      throw (
        verification.error ??
        new AppError('E_CONFLICT', `首次连接需要确认主机指纹：${verification.fingerprint}`)
      )
    }

    return { fingerprint: verification.fingerprint, keyType: verification.keyType }
  }

  private requireSftp(): Promise<SFTPWrapper> {
    if (this.sftpSession) return Promise.resolve(this.sftpSession)
    return new Promise<SFTPWrapper>((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(new AppError('E_UNKNOWN', `无法打开 SFTP 会话：${error.message}`))
          return
        }
        this.sftpSession = sftp
        resolve(sftp)
      })
    })
  }

  async sftp(): Promise<SFTPWrapper> {
    return this.requireSftp()
  }

  /** 底层 ssh2 会话，供 exec 包装器复用（不要直接 close） */
  get raw(): Client {
    return this.client
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.sftpSession = null
    try {
      this.client.end()
    } catch {
      // 连接已断开
    }
  }
}

function execOnce(
  client: Client,
  command: string,
  options: RemoteExecOptions
): Promise<RemoteRunResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: RemoteRunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(
      () => finish({ code: null, stdout: '', stderr: '远端命令超时', timedOut: true }),
      options.timeoutMs ?? REMOTE_LIMITS.execTimeoutMs
    )

    client.exec(command, (error, stream) => {
      if (error) {
        finish({ code: null, stdout: '', stderr: '', spawnError: error.message })
        return
      }
      let stdout = ''
      let stderr = ''
      stream.on('data', (chunk: Buffer) => {
        if (stdout.length < 4 * 1024 * 1024) stdout += chunk.toString('utf8')
      })
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8000)
      })
      stream.on('close', (code: number | null) => finish({ code, stdout, stderr }))
      stream.on('error', (streamError: Error) =>
        finish({ code: null, stdout, stderr, spawnError: streamError.message })
      )
    })
  })
}

export interface SshExecOptions {
  client: Client
  rootPath: string
  label?: string
}

/** 把一条已连接的 SSH 会话包装成 RemoteExec（Git / 搜索 / 任务共用） */
export function createSshExec(options: SshExecOptions): RemoteExec {
  const rootPath = normalizeRemoteRoot(options.rootPath)
  const label = options.label ?? 'SSH'

  const run = (
    command: string,
    args: string[],
    runOptions: RemoteExecOptions = {}
  ): Promise<RemoteRunResult> => {
    const cwd = runOptions.cwd ?? rootPath
    const line = `cd ${shellQuotePath(cwd)} && ${buildRemoteCommandLine(command, args)}`
    return execOnce(options.client, line, runOptions)
  }

  const stream = (
    command: string,
    args: string[],
    streamOptions: RemoteStreamOptions
  ): RemoteStreamHandle => {
    const cwd = streamOptions.cwd ?? rootPath
    const line = `cd ${shellQuotePath(cwd)} && ${buildRemoteCommandLine(command, args)}`
    let stream: { close?: () => void; destroy?: () => void } | null = null
    let cancelled = false

    const done = new Promise<{ code: number | null; stderr: string }>((resolve) => {
      options.client.exec(line, (error, channel) => {
        if (error) {
          resolve({ code: null, stderr: error.message })
          return
        }
        stream = channel as unknown as { close?: () => void; destroy?: () => void }
        let stderr = ''
        let buffer = ''
        const flush = (chunk: string, final: boolean): void => {
          buffer += chunk
          const lines = buffer.split(/\r?\n/)
          buffer = final ? '' : (lines.pop() ?? '')
          for (const l of lines) {
            if (l.trim() && !cancelled) streamOptions.onLine(l)
          }
        }
        channel.on('data', (chunk: Buffer) => flush(chunk.toString('utf8'), false))
        channel.stderr.on('data', (chunk: Buffer) => {
          stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8000)
          streamOptions.onStderr?.(chunk.toString('utf8'))
        })
        channel.on('close', (code: number | null) => {
          flush('', true)
          resolve({ code: cancelled ? null : code, stderr })
        })
        channel.on('error', (streamError: Error) =>
          resolve({ code: null, stderr: streamError.message })
        )
      })
    })

    return {
      cancel: () => {
        cancelled = true
        stream?.destroy?.()
        stream?.close?.()
      },
      done
    }
  }

  const spawnTask = (
    command: string,
    args: string[],
    spawnOptions: RemoteSpawnOptions
  ): RemoteSpawnHandle => {
    const cwd = spawnOptions.cwd ?? rootPath
    const line = `cd ${shellQuotePath(cwd)} && ${buildRemoteCommandLine(command, args)}`
    let channel: { close?: () => void; destroy?: () => void } | null = null
    let settled = false

    options.client.exec(line, (error, stream) => {
      if (error) {
        if (!settled) {
          settled = true
          spawnOptions.onExit(null, error.message)
        }
        return
      }
      channel = stream as unknown as { close?: () => void; destroy?: () => void }
      stream.on('data', (chunk: Buffer) => spawnOptions.onStdout(chunk.toString('utf8')))
      stream.stderr.on('data', (chunk: Buffer) => spawnOptions.onStderr(chunk.toString('utf8')))
      stream.on('close', (code: number | null) => {
        if (settled) return
        settled = true
        spawnOptions.onExit(code)
      })
      stream.on('error', (streamError: Error) => {
        if (settled) return
        settled = true
        spawnOptions.onExit(null, streamError.message)
      })
    })

    return {
      kill: () => {
        channel?.destroy?.()
        channel?.close?.()
      }
    }
  }

  return {
    kind: 'ssh',
    label,
    rootPath,
    localRoot: null,
    run,
    stream,
    spawn: spawnTask,
    // SSH 的文件访问走 SFTP，本地路径无法映射回远端
    toRemotePath: () => null
  }
}

function shellQuotePath(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export { joinRemotePath }
