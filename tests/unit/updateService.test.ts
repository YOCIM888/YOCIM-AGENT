import { describe, expect, it, vi } from 'vitest'
import {
  checkForUpdate,
  type UpdateFetch,
  type UpdateFetchResponse
} from '../../src/main/update/updateService'
import {
  compareVersions,
  isNewerVersion,
  normalizeVersion,
  resolveAppVersion,
  selectReleaseAsset,
  UPDATE_API_URL,
  UPDATE_NOTES_MAX,
  type ReleaseAsset
} from '../../src/shared/update'

function jsonResponse(body: unknown, ok = true, status = 200): UpdateFetchResponse {
  return { ok, status, json: async () => body }
}

const asset = (name: string): ReleaseAsset => ({
  name,
  browser_download_url: `https://github.com/YOCIM888/YOCIM-AGENT/releases/download/v0.2.0/${encodeURIComponent(name)}`,
  size: 1024
})

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/YOCIM888/YOCIM-AGENT/releases/tag/v0.2.0',
    name: 'YOCIM AGENT 0.2.0',
    body: '## 新增\n检查更新\n\n## 修复\n若干问题',
    published_at: '2026-11-16T10:00:00Z',
    assets: [asset('YOCIM AGENT-0.2.0-arm64-setup.exe'), asset('YOCIM AGENT-0.2.0-x64-setup.exe')],
    ...overrides
  }
}

describe('version helpers', () => {
  it('falls back to the app version when Electron reports its own version', () => {
    expect(resolveAppVersion('0.1.0', '45.3.2', '0.1.0')).toBe('0.1.0')
    expect(resolveAppVersion('45.3.2', '45.3.2', '0.1.0')).toBe('0.1.0')
    expect(resolveAppVersion('', '45.3.2', '0.1.0')).toBe('0.1.0')
    expect(resolveAppVersion('0.2.0', '45.3.2', '0.1.0')).toBe('0.2.0')
  })

  it('normalizes tags and compares semantic versions', () => {
    expect(normalizeVersion('v0.2.0')).toBe('0.2.0')
    expect(normalizeVersion('0.2.1-beta.1+build.7')).toBe('0.2.1-beta.1')
    expect(normalizeVersion('latest')).toBe('')

    expect(compareVersions('v0.2.0', '0.1.0')).toBe(1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.9', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBe(-1)
    expect(compareVersions('bogus', '0.1.0')).toBeNull()
    expect(isNewerVersion('v0.1.1', '0.1.0')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false)
  })

  it('picks the installer for the current platform and architecture', () => {
    const assets = [
      asset('YOCIM-0.2.0.dmg'),
      asset('YOCIM-0.2.0-arm64.AppImage'),
      asset('YOCIM-0.2.0-x64.AppImage'),
      asset('YOCIM-0.2.0-x64-setup.exe'),
      asset('YOCIM-0.2.0-arm64-setup.exe')
    ]
    expect(selectReleaseAsset(assets, 'win32', 'x64')?.name).toContain('x64-setup.exe')
    expect(selectReleaseAsset(assets, 'win32', 'arm64')?.name).toContain('arm64-setup.exe')
    expect(selectReleaseAsset(assets, 'darwin', 'arm64')?.name).toContain('.dmg')
    expect(selectReleaseAsset(assets, 'linux', 'x64')?.name).toContain('x64.AppImage')
    expect(selectReleaseAsset(assets, 'linux', 'arm64')?.name).toContain('arm64.AppImage')
    expect(selectReleaseAsset([], 'win32', 'x64')).toBeNull()
    expect(selectReleaseAsset(assets, 'freebsd', 'x64')).toBeNull()
  })
})

describe('checkForUpdate', () => {
  it('returns download info when a newer release exists', async () => {
    const fetchImpl = vi.fn<UpdateFetch>(async () => jsonResponse(release()))
    const result = await checkForUpdate({
      currentVersion: '0.1.0',
      platform: 'win32',
      arch: 'x64',
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      UPDATE_API_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/vnd.github+json' })
      })
    )
    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.info.version).toBe('0.2.0')
    expect(result.info.assetName).toContain('x64-setup.exe')
    expect(result.info.downloadUrl).toContain('releases/download')
    expect(result.info.notes).toContain('检查更新')
  })

  it('falls back to the release page when there is no matching asset', async () => {
    const fetchImpl = vi.fn<UpdateFetch>(async () => jsonResponse(release({ assets: [] })))
    const result = await checkForUpdate({
      currentVersion: '0.1.0',
      platform: 'linux',
      arch: 'x64',
      fetchImpl
    })

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.info.downloadUrl).toBe(
      'https://github.com/YOCIM888/YOCIM-AGENT/releases/tag/v0.2.0'
    )
    expect(result.info.assetName).toBe('')
  })

  it('truncates long release notes', async () => {
    const fetchImpl = vi.fn<UpdateFetch>(async () =>
      jsonResponse(release({ body: '行'.repeat(UPDATE_NOTES_MAX + 100) }))
    )
    const result = await checkForUpdate({ currentVersion: '0.1.0', fetchImpl })

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.info.notes).toHaveLength(UPDATE_NOTES_MAX)
  })

  it('reports current version without treating prereleases as newer', async () => {
    const fetchImpl = vi.fn<UpdateFetch>(async () =>
      jsonResponse(release({ tag_name: 'v0.1.0-beta.2' }))
    )
    const result = await checkForUpdate({ currentVersion: '0.1.0', fetchImpl })
    expect(result).toEqual({ status: 'current', currentVersion: '0.1.0' })
  })

  it('skips the request when offline', async () => {
    const fetchImpl = vi.fn<UpdateFetch>(async () => jsonResponse(release()))
    const result = await checkForUpdate({
      currentVersion: '0.1.0',
      fetchImpl,
      isOnline: () => false
    })
    expect(result).toEqual({ status: 'offline' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('converts HTTP errors, bad payloads and network failures into results', async () => {
    expect(
      await checkForUpdate({
        currentVersion: '0.1.0',
        fetchImpl: async () => jsonResponse({}, false, 403)
      })
    ).toEqual({ status: 'error', message: 'GitHub 返回 403' })

    expect(
      await checkForUpdate({
        currentVersion: '0.1.0',
        fetchImpl: async () => jsonResponse({ tag_name: 42 })
      })
    ).toEqual({ status: 'error', message: 'Release 数据格式异常' })

    const failed = await checkForUpdate({
      currentVersion: '0.1.0',
      fetchImpl: async () => {
        throw new Error('network down')
      }
    })
    expect(failed.status).toBe('error')
    if (failed.status === 'error') expect(failed.message).toContain('network down')
  })
})
