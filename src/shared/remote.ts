/**
 * 远程工作区（P5）：WSL 与 SSH 目标、连接状态与环境探测的共享契约。
 *
 * 设计要点：
 * - 目标是「可保存的连接配置」，口令类信息只在主进程经 safeStorage 加密保存，
 *   renderer 永远拿不到明文（`hasSecret` 只说明是否存在）。
 * - SSH 采用 TOFU：首次连接记录主机指纹，之后指纹变化直接阻断并要求用户确认。
 */

export type RemoteKind = 'wsl' | 'ssh'

export type RemoteAuthType = 'agent' | 'key' | 'password'

export interface RemoteTarget {
  id: string
  kind: RemoteKind
  name: string
  /** WSL 发行版名，如 `Ubuntu-22.04` */
  distro?: string
  /** SSH 主机（域名或 IP） */
  host?: string
  /** SSH 端口，默认 22 */
  port?: number
  /** SSH 用户名 */
  username?: string
  authType?: RemoteAuthType
  /** 私钥文件路径（authType=key） */
  keyPath?: string
  /** 远端工作区绝对路径；WSL 为 Linux 路径（/home/me/project），SSH 同理 */
  rootPath: string
  /** 已信任的主机指纹（SHA256:... 形式） */
  hostFingerprint?: string
  /** 是否保存了口令/私钥口令 */
  hasSecret: boolean
  createdAt: number
  updatedAt: number
}

/** 新增/编辑目标的入参；`secret` 只进不出，回传的 RemoteTarget 里没有它 */
export interface RemoteTargetInput {
  id?: string
  kind: RemoteKind
  name?: string
  distro?: string
  host?: string
  port?: number
  username?: string
  authType?: RemoteAuthType
  keyPath?: string
  rootPath: string
  secret?: string
  /** 首次连接遇到未知主机指纹时，用户确认信任后置 true */
  trustHostFingerprint?: boolean
}

export type RemoteStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface RemoteEnvironment {
  platform: string
  wsl: {
    available: boolean
    distros: string[]
    defaultDistro?: string
    version?: string
    error?: string
  }
  ssh: {
    available: boolean
    /** 实际使用的客户端：内置 ssh2（可做严格指纹校验与 SFTP） */
    client: 'ssh2'
    version?: string
    error?: string
  }
}

export interface RemoteConnectionState {
  targetId: string | null
  kind: RemoteKind | null
  status: RemoteStatus
  /** 目标侧的工作区路径（Linux 路径） */
  rootPath: string | null
  /** 展示用根路径（WSL 为 UNC 路径，SSH 为 host:path） */
  displayRoot: string | null
  label: string
  error?: string
  since: number | null
  /** 未知主机指纹：UI 需要用户确认后才能继续连接 */
  pendingFingerprint?: { fingerprint: string; keyType: string }
}

export interface RemoteTargetSummary extends RemoteTarget {
  connected: boolean
  /** 最近一次连接失败原因（仅内存态） */
  lastError?: string
}

export const REMOTE_LIMITS = {
  maxTargets: 20,
  maxNameLength: 60,
  maxHostLength: 255,
  maxUsernameLength: 64,
  maxDistroLength: 80,
  maxPathLength: 1024,
  maxSecretLength: 1024,
  maxKeyPathLength: 1024,
  maxDistros: 50,
  probeTimeoutMs: 8000,
  connectTimeoutMs: 20000,
  /** 普通远程命令超时 */
  execTimeoutMs: 60000,
  /** 网络类远程命令（pull/push）超时 */
  networkTimeoutMs: 180000,
  maxListingEntries: 500,
  maxFileBytes: 2 * 1024 * 1024
} as const
