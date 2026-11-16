/** GitHub Releases 更新检查的公共契约（主进程与渲染层共用）。 */

import { APP_VERSION } from './app'

export const UPDATE_REPO = 'YOCIM888/YOCIM-AGENT'
export const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
export const UPDATE_RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`
/** 单次检查的网络超时，避免离线或限流时卡住启动流程 */
export const UPDATE_TIMEOUT_MS = 10_000
/** 更新说明展示上限，防止超长 Release Notes 撑爆通知卡 */
export const UPDATE_NOTES_MAX = 600

export interface UpdateInfo {
  /** 去掉 v 前缀后的版本号，例如 0.2.0 */
  version: string
  /** GitHub 原始 tag */
  tag: string
  name: string
  notes: string
  publishedAt: string
  /** Release 页面，用户查看完整说明 */
  url: string
  /** 匹配当前平台的安装包直链，没有匹配资产时回退到 Release 页面 */
  downloadUrl: string
  assetName: string
}

export type UpdateCheckResult =
  | { status: 'available'; info: UpdateInfo }
  | { status: 'current'; currentVersion: string }
  | { status: 'offline' }
  | { status: 'error'; message: string }

/**
 * 未打包运行时 app.getVersion() 可能回退成 Electron 自身版本，
 * 此时用应用常量兜底，避免更新检查拿浏览器内核版本去比较。
 */
export function resolveAppVersion(
  fromApp: string,
  electronVersion: string,
  fallback: string = APP_VERSION
): string {
  return fromApp && fromApp !== electronVersion ? fromApp : fallback
}

/** 只保留 x.y.z（可带 prerelease），忽略 v 前缀与构建元数据 */
export function normalizeVersion(raw: string): string {
  const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(raw.trim())
  return match?.[1] ?? ''
}

/**
 * 语义化版本比较：返回 1 表示 a 更新，-1 表示 a 更旧，0 表示相同。
 * 无法解析的版本返回 null，调用方按「不更新」保守处理。
 */
export function compareVersions(a: string, b: string): number | null {
  const left = normalizeVersion(a)
  const right = normalizeVersion(b)
  if (!left || !right) return null

  const [leftCore, leftPre] = left.split('-', 2) as [string, string | undefined]
  const [rightCore, rightPre] = right.split('-', 2) as [string, string | undefined]
  const leftParts = leftCore.split('.').map(Number)
  const rightParts = rightCore.split('.').map(Number)

  for (let i = 0; i < 3; i += 1) {
    if ((leftParts[i] ?? 0) > (rightParts[i] ?? 0)) return 1
    if ((leftParts[i] ?? 0) < (rightParts[i] ?? 0)) return -1
  }
  // 无 prerelease 的版本比带 prerelease 的版本新
  if (!leftPre && rightPre) return 1
  if (leftPre && !rightPre) return -1
  if (!leftPre && !rightPre) return 0
  return leftPre === rightPre ? 0 : leftPre! > rightPre! ? 1 : -1
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) === 1
}

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size?: number
}

/** 按平台与架构挑选安装包；优先同架构，其次任意同平台资产 */
export function selectReleaseAsset(
  assets: ReleaseAsset[],
  platform: string,
  arch: string
): ReleaseAsset | null {
  const pattern =
    platform === 'win32'
      ? /\.exe$/i
      : platform === 'darwin'
        ? /\.dmg$/i
        : platform === 'linux'
          ? /\.appimage$/i
          : null
  if (!pattern) return null

  const candidates = assets.filter(
    (asset) => pattern.test(asset.name) && typeof asset.browser_download_url === 'string'
  )
  if (candidates.length === 0) return null

  const archToken =
    arch === 'arm64'
      ? /arm64|aarch64/i
      : arch === 'ia32'
        ? /x86(?!_64)|ia32|win32/i
        : /x64|amd64|x86_64/i
  return candidates.find((asset) => archToken.test(asset.name)) ?? candidates[0] ?? null
}
