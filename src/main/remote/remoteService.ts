import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { safeStorage } from 'electron'
import { AppError } from '../../shared/errors'
import type { WorkspaceInfo } from '../../shared/ipc'
import {
  REMOTE_LIMITS,
  type RemoteConnectionState,
  type RemoteEnvironment,
  type RemoteTargetInput,
  type RemoteTargetSummary
} from '../../shared/remote'
import type { RemoteTargetRecord, RemoteTargetRepository } from '../db/repositories'
import { normalizeRemoteRoot, parseWslUncPath, toWslUncPath } from './command'
import { createSshExec, SshClient, type SshConnectResult } from './sshClient'
import { createWslExec, probeWsl } from './wslExec'

/**
 * 远程工作区服务（P5）。
 *
 * - WSL：工作区根是 `\\wsl.localhost\<distro>\...`，文件走本地 fs（复用编辑器/文件树），
 *   Git/搜索/任务经 `wsl.exe --exec` 在发行版内执行。
 * - SSH：文件走 SFTP，命令经 ssh2 exec；主机指纹按 TOFU 校验，变化即阻断。
 */

interface RemoteServiceOptions {
  targets: RemoteTargetRepository
  /** 打开远程工作区（由 workspaceService 提供） */
  openWorkspace: (info: WorkspaceInfo) => Promise<WorkspaceInfo>
  /** 断开后恢复的工作区（通常是连接前的本地工作区） */
  restoreWorkspaceRoot: (root: string | null) => Promise<WorkspaceInfo | null>
  setRemoteExec: (exec: ReturnType<typeof createWslExec> | null) => void
}

interface ActiveConnection {
  target: RemoteTargetRecord
  workspace: WorkspaceInfo | null
  client: SshClient | null
  state: RemoteConnectionState
}

const CONNECTED_LABEL: Record<'wsl' | 'ssh', string> = { wsl: 'WSL', ssh: 'SSH' }

export class RemoteService {
  private readonly options: RemoteServiceOptions
  private active: ActiveConnection | null = null
  private readonly errors = new Map<string, string>()
  private previousLocalRoot: string | null = null

  constructor(options: RemoteServiceOptions) {
    this.options = options
  }

  async probe(): Promise<RemoteEnvironment> {
    const wsl = await probeWsl()
    return {
      platform: process.platform,
      wsl: {
        available: wsl.available,
        distros: wsl.distros,
        ...(wsl.defaultDistro ? { defaultDistro: wsl.defaultDistro } : {}),
        ...(wsl.version ? { version: wsl.version } : {}),
        ...(wsl.error ? { error: wsl.error } : {})
      },
      ssh: {
        available: true,
        client: 'ssh2'
      }
    }
  }

  list(): RemoteTargetSummary[] {
    return this.options.targets.list().map((record) => this.toSummary(record))
  }

  current(): RemoteConnectionState {
    if (this.active) return { ...this.active.state }
    return {
      targetId: null,
      kind: null,
      status: 'disconnected',
      rootPath: null,
      displayRoot: null,
      label: '本地工作区',
      since: null
    }
  }

  private toSummary(record: RemoteTargetRecord): RemoteTargetSummary {
    const connected =
      this.active?.target.id === record.id && this.active.state.status === 'connected'
    const lastError = this.errors.get(record.id)
    return {
      id: record.id,
      kind: record.kind,
      name: record.name,
      ...(record.distro ? { distro: record.distro } : {}),
      ...(record.host ? { host: record.host } : {}),
      ...(record.port !== null ? { port: record.port } : {}),
      ...(record.username ? { username: record.username } : {}),
      ...(record.authType ? { authType: record.authType } : {}),
      ...(record.keyPath ? { keyPath: record.keyPath } : {}),
      rootPath: record.rootPath,
      ...(record.hostFingerprint ? { hostFingerprint: record.hostFingerprint } : {}),
      hasSecret: Boolean(record.secretEncrypted),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      connected,
      ...(lastError ? { lastError } : {})
    }
  }

  private encryptSecret(secret: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new AppError('E_UNSUPPORTED', '当前系统不支持安全存储，无法保存 SSH 口令')
    }
    return safeStorage.encryptString(secret).toString('base64')
  }

  private decryptSecret(record: RemoteTargetRecord): string | undefined {
    if (!record.secretEncrypted) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(record.secretEncrypted, 'base64'))
    } catch {
      return undefined
    }
  }

  private validate(input: RemoteTargetInput): void {
    const kind = input.kind
    if (kind === 'wsl') {
      if (!input.distro?.trim()) throw new AppError('E_INVALID_INPUT', '请选择或填写 WSL 发行版')
    } else {
      if (!input.host?.trim()) throw new AppError('E_INVALID_INPUT', '请填写 SSH 主机地址')
      if (!input.username?.trim()) throw new AppError('E_INVALID_INPUT', '请填写 SSH 用户名')
      const port = input.port ?? 22
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new AppError('E_INVALID_INPUT', 'SSH 端口必须在 1-65535 之间')
      }
      if (input.authType === 'key' && !input.keyPath?.trim()) {
        throw new AppError('E_INVALID_INPUT', '私钥认证需要填写私钥文件路径')
      }
      if (input.authType === 'key' && input.keyPath && !isAbsolute(input.keyPath)) {
        throw new AppError('E_INVALID_INPUT', '私钥路径需要是绝对路径')
      }
      if (input.host.includes('://')) {
        throw new AppError('E_INVALID_INPUT', '主机地址不要带协议前缀，例如只填 example.com')
      }
    }
    normalizeRemoteRoot(input.rootPath)
  }

  private defaultName(input: RemoteTargetInput): string {
    if (input.name?.trim()) return input.name.trim().slice(0, REMOTE_LIMITS.maxNameLength)
    if (input.kind === 'wsl') {
      const path = input.rootPath.split('/').filter(Boolean).pop() ?? 'WSL'
      return `${input.distro ?? 'WSL'} · ${path}`.slice(0, REMOTE_LIMITS.maxNameLength)
    }
    const path = input.rootPath.split('/').filter(Boolean).pop() ?? 'SSH'
    return `${input.username ?? ''}@${input.host ?? ''}:${path}`.slice(
      0,
      REMOTE_LIMITS.maxNameLength
    )
  }

  save(input: RemoteTargetInput): RemoteTargetSummary[] {
    this.validate(input)
    const existing = input.id ? this.options.targets.get(input.id) : null
    if (!existing && this.options.targets.list().length >= REMOTE_LIMITS.maxTargets) {
      throw new AppError(
        'E_CONFLICT',
        `远程目标最多 ${REMOTE_LIMITS.maxTargets} 个，请先删除不用的目标`
      )
    }

    const now = Date.now()
    const record: RemoteTargetRecord = {
      id: existing?.id ?? randomUUID(),
      kind: input.kind,
      name: this.defaultName(input),
      distro: input.kind === 'wsl' ? (input.distro?.trim() ?? null) : null,
      host: input.kind === 'ssh' ? (input.host?.trim() ?? null) : null,
      port: input.kind === 'ssh' ? (input.port ?? 22) : null,
      username: input.kind === 'ssh' ? (input.username?.trim() ?? null) : null,
      authType: input.kind === 'ssh' ? (input.authType ?? 'key') : null,
      keyPath:
        input.kind === 'ssh' && input.authType === 'key' ? (input.keyPath?.trim() ?? null) : null,
      rootPath: normalizeRemoteRoot(input.rootPath),
      hostFingerprint: existing?.hostFingerprint ?? null,
      secretEncrypted: input.secret
        ? this.encryptSecret(input.secret)
        : (existing?.secretEncrypted ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    this.options.targets.upsert(record)
    this.errors.delete(record.id)
    return this.list()
  }

  delete(id: string): RemoteTargetSummary[] {
    if (this.active?.target.id === id) {
      void this.disconnect()
    }
    this.options.targets.delete(id)
    this.errors.delete(id)
    return this.list()
  }

  private updateState(patch: Partial<RemoteConnectionState>): RemoteConnectionState {
    if (!this.active) return this.current()
    this.active.state = { ...this.active.state, ...patch }
    return { ...this.active.state }
  }

  async connect(
    id: string,
    options: { trustHostFingerprint?: boolean } = {}
  ): Promise<{ connection: RemoteConnectionState; workspace: WorkspaceInfo | null }> {
    const record = this.options.targets.get(id)
    if (!record) throw new AppError('E_NOT_FOUND', '远程目标不存在，请刷新列表')

    if (this.active) await this.disconnect()

    this.active = {
      target: record,
      workspace: null,
      client: null,
      state: {
        targetId: record.id,
        kind: record.kind,
        status: 'connecting',
        rootPath: record.rootPath,
        displayRoot: null,
        label: `${CONNECTED_LABEL[record.kind]} · ${record.name}`,
        since: null
      }
    }

    try {
      if (record.kind === 'wsl') {
        return await this.connectWsl(record)
      }
      return await this.connectSsh(record, options.trustHostFingerprint === true)
    } catch (error) {
      const message = error instanceof AppError ? error.message : '远程连接失败'
      this.errors.set(record.id, message)
      this.updateState({ status: 'error', error: message })
      if (this.active?.client) this.active.client.close()
      this.active = this.active ? { ...this.active, client: null } : null
      throw error instanceof AppError ? error : new AppError('E_UNKNOWN', message)
    }
  }

  private async connectWsl(
    record: RemoteTargetRecord
  ): Promise<{ connection: RemoteConnectionState; workspace: WorkspaceInfo | null }> {
    const distro = record.distro ?? ''
    const exec = createWslExec({ distro, rootPath: record.rootPath })
    const check = await exec.run('test', ['-d', record.rootPath], {
      timeoutMs: REMOTE_LIMITS.connectTimeoutMs
    })
    if (check.spawnError) {
      throw new AppError('E_UNKNOWN', `无法调用 wsl.exe：${check.spawnError}`)
    }
    if (check.code !== 0) {
      throw new AppError(
        'E_NOT_FOUND',
        `WSL 中的路径不存在或不可访问：${record.rootPath}（发行版 ${distro}）`
      )
    }

    const uncRoot = toWslUncPath(distro, record.rootPath)
    const info = await this.options.openWorkspace({
      root: uncRoot,
      name: record.name,
      remote: {
        kind: 'wsl',
        targetId: record.id,
        label: `WSL · ${distro}`,
        rootPath: record.rootPath,
        displayRoot: uncRoot
      }
    })

    this.options.setRemoteExec(exec)
    if (this.active) this.active.workspace = info
    const state = this.updateState({
      status: 'connected',
      rootPath: record.rootPath,
      displayRoot: uncRoot,
      since: Date.now(),
      error: undefined,
      pendingFingerprint: undefined
    })
    return { connection: state, workspace: info }
  }

  private async connectSsh(
    record: RemoteTargetRecord,
    trustHostFingerprint: boolean
  ): Promise<{ connection: RemoteConnectionState; workspace: WorkspaceInfo | null }> {
    const client = new SshClient()
    const secret = this.decryptSecret(record)
    let result: SshConnectResult
    try {
      result = await client.connect({
        host: record.host ?? '',
        port: record.port ?? 22,
        username: record.username ?? '',
        authType: record.authType ?? 'key',
        ...(record.keyPath ? { keyPath: record.keyPath } : {}),
        ...(secret ? { secret } : {}),
        ...(record.hostFingerprint ? { expectedFingerprint: record.hostFingerprint } : {}),
        trustUnknownHost: trustHostFingerprint
      })
    } catch (error) {
      client.close()
      const message = error instanceof AppError ? error.message : 'SSH 连接失败'
      const fingerprint = /SHA256:[A-Za-z0-9+/=]+/.exec(message)?.[0]
      if (error instanceof AppError && error.code === 'E_CONFLICT' && fingerprint) {
        // 首连确认或指纹变更后的重新信任：把指纹交给 UI，不当作硬错误
        this.updateState({
          status: 'connecting',
          error: message,
          pendingFingerprint: { fingerprint, keyType: 'unknown' }
        })
        return { connection: this.current(), workspace: null }
      }
      throw error
    }

    this.active = this.active ? { ...this.active, client } : null

    const exec = createSshExec({
      client: client.raw,
      rootPath: record.rootPath,
      label: `SSH · ${record.name}`
    })
    const check = await exec.run('test', ['-d', record.rootPath], {
      timeoutMs: REMOTE_LIMITS.connectTimeoutMs
    })
    if (check.code !== 0) {
      client.close()
      throw new AppError('E_NOT_FOUND', `远端路径不存在或不可访问：${record.rootPath}`)
    }

    if (result.fingerprint !== record.hostFingerprint) {
      this.options.targets.setHostFingerprint(record.id, result.fingerprint)
    }

    const displayRoot = `${record.username}@${record.host}:${record.port ?? 22}${record.rootPath}`
    const info = await this.options.openWorkspace({
      root: `ssh://${record.id}${record.rootPath}`,
      name: record.name,
      remote: {
        kind: 'ssh',
        targetId: record.id,
        label: `SSH · ${record.name}`,
        rootPath: record.rootPath,
        displayRoot
      }
    })

    this.options.setRemoteExec(exec)
    if (this.active) this.active.workspace = info
    const state = this.updateState({
      status: 'connected',
      rootPath: record.rootPath,
      displayRoot,
      since: Date.now(),
      error: undefined,
      pendingFingerprint: undefined
    })
    return { connection: state, workspace: info }
  }

  async disconnect(): Promise<{
    connection: RemoteConnectionState
    workspace: WorkspaceInfo | null
  }> {
    const active = this.active
    this.active = null
    this.options.setRemoteExec(null)
    if (active?.client) active.client.close()

    const workspace = await this.options
      .restoreWorkspaceRoot(this.previousLocalRoot)
      .catch(() => null)
    return { connection: this.current(), workspace }
  }

  /** 当前 SSH 会话的 SFTP 通道（文件读写用）；非 SSH 工作区直接报错 */
  async sshSftp(): Promise<import('ssh2').SFTPWrapper> {
    if (!this.active || this.active.target.kind !== 'ssh' || !this.active.client) {
      throw new AppError('E_UNSUPPORTED', '当前不是 SSH 远程工作区')
    }
    return this.active.client.sftp()
  }

  /** 连接前记录本地工作区，断开后可回到原处 */
  rememberLocalRoot(root: string | null): void {
    if (root && !root.startsWith('ssh://')) this.previousLocalRoot = root
  }

  /** 用户切到本地工作区：静默断开，不恢复旧根 */
  forget(): void {
    this.options.setRemoteExec(null)
    if (this.active?.client) this.active.client.close()
    this.active = null
  }

  dispose(): void {
    this.options.setRemoteExec(null)
    if (this.active?.client) this.active.client.close()
    this.active = null
  }
}

export { parseWslUncPath }
