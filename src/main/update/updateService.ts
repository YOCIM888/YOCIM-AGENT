import { z } from 'zod'
import {
  isDomesticNetwork,
  isNewerVersion,
  normalizeVersion,
  selectReleaseAsset,
  UPDATE_ENDPOINT_TIMEOUT_MS,
  UPDATE_NOTES_MAX,
  UPDATE_TIMEOUT_MS,
  updateApiUrls,
  type ReleaseAsset,
  type UpdateCheckResult,
  type UpdateInfo
} from '../../shared/update'

export interface UpdateFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type UpdateFetch = (url: string, init?: RequestInit) => Promise<UpdateFetchResponse>

export interface CheckUpdateOptions {
  currentVersion: string
  platform?: string
  arch?: string
  fetchImpl?: UpdateFetch
  isOnline?: () => boolean
  timeoutMs?: number
  /** 覆盖国内网络判断；不传则按系统时区/语言自动检测 */
  isDomestic?: boolean
  /** 显式指定候选地址并按顺序尝试；不传则按网络环境排序 */
  apiUrls?: string[]
}

const releaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string().url(),
  name: z.string().nullish(),
  body: z.string().nullish(),
  published_at: z.string().nullish(),
  assets: z
    .array(
      z.object({
        name: z.string(),
        browser_download_url: z.string().url(),
        size: z.number().optional()
      })
    )
    .default([])
})

function excerpt(body: string | null | undefined): string {
  return (body ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, UPDATE_NOTES_MAX)
}

/**
 * 查询 GitHub Releases latest 并与当前版本比较。
 * 国内默认走稳定镜像，任一端点失败自动尝试下一个；所有异常都收敛成结果对象，
 * 调用方不需要 try/catch；离线/失败不会打断启动。
 */
export async function checkForUpdate(options: CheckUpdateOptions): Promise<UpdateCheckResult> {
  if (options.isOnline && !options.isOnline()) return { status: 'offline' }

  const doFetch: UpdateFetch =
    options.fetchImpl ?? ((url, init) => fetch(url, init) as Promise<UpdateFetchResponse>)
  const urls = options.apiUrls ?? updateApiUrls(options.isDomestic ?? isDomesticNetwork())
  const timeoutMs =
    options.timeoutMs ?? (urls.length > 1 ? UPDATE_ENDPOINT_TIMEOUT_MS : UPDATE_TIMEOUT_MS)
  let lastMessage = '检查失败：未知错误'

  for (const url of urls) {
    try {
      const response = await doFetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `YOCIM-AGENT/${options.currentVersion}`
        },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!response.ok) {
        lastMessage = `GitHub 返回 ${response.status}`
        continue
      }

      const parsed = releaseSchema.safeParse(await response.json())
      if (!parsed.success) {
        lastMessage = 'Release 数据格式异常'
        continue
      }

      const release = parsed.data
      const version = normalizeVersion(release.tag_name)
      if (!version) {
        lastMessage = 'Release 版本号无法解析'
        continue
      }
      if (!isNewerVersion(version, options.currentVersion)) {
        return { status: 'current', currentVersion: options.currentVersion }
      }

      const asset = selectReleaseAsset(
        release.assets as ReleaseAsset[],
        options.platform ?? process.platform,
        options.arch ?? process.arch
      )
      const info: UpdateInfo = {
        version,
        tag: release.tag_name,
        name: release.name?.trim() || release.tag_name,
        notes: excerpt(release.body),
        publishedAt: release.published_at ?? '',
        url: release.html_url,
        downloadUrl: asset?.browser_download_url ?? release.html_url,
        assetName: asset?.name ?? ''
      }
      return { status: 'available', info }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastMessage = /timeout|abort/i.test(message) ? '检查超时，请稍后重试' : `检查失败：${message}`
    }
  }

  return { status: 'error', message: lastMessage }
}
