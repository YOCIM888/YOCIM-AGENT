import { describe, expect, it, vi } from 'vitest'
import {
  BROWSER_PARTITION_PREFIX,
  BROWSER_STORAGE_TYPES,
  isYocimPartitionName
} from '../../src/shared/browser'
import {
  BrowserDataService,
  collectBrowserPartitions,
  type BrowserDataServiceDeps,
  type BrowserStorageSession
} from '../../src/main/browser/browserDataService'

function sessionMock(): BrowserStorageSession {
  return {
    clearStorageData: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined)
  }
}

function depsMock(overrides: Partial<BrowserDataServiceDeps> = {}): BrowserDataServiceDeps {
  return {
    getSession: () => sessionMock(),
    listPartitions: async () => [],
    removePartition: async () => undefined,
    clearAuditFile: async () => undefined,
    disposeAll: () => undefined,
    activePartitions: () => [],
    ...overrides
  }
}

describe('browser partition whitelist', () => {
  it('accepts only this app’s isolated profiles', () => {
    expect(isYocimPartitionName(`${BROWSER_PARTITION_PREFIX}proj_session`)).toBe(true)
    expect(isYocimPartitionName(`${BROWSER_PARTITION_PREFIX}../etc`)).toBe(false)
    expect(isYocimPartitionName(`${BROWSER_PARTITION_PREFIX}a/b`)).toBe(false)
    expect(isYocimPartitionName('Default')).toBe(false)
    expect(isYocimPartitionName('persist:other-app')).toBe(false)
    expect(isYocimPartitionName('yocim-browser-')).toBe(false)
  })

  it('merges disk and active partitions, dedupes and strips persist prefix', () => {
    expect(
      collectBrowserPartitions(
        [
          'Default',
          'yocim-browser-disk',
          'yocim-browser-shared',
          'yocim-browser-disk',
          'yocim-browser-../evil'
        ],
        ['persist:yocim-browser-shared', 'persist:yocim-browser-live', 'persist:Default']
      )
    ).toEqual(['yocim-browser-disk', 'yocim-browser-live', 'yocim-browser-shared'])
  })
})

describe('BrowserDataService.reset', () => {
  it('collects active partitions before disposing and clears every isolated profile', async () => {
    const order: string[] = []
    const session = sessionMock()
    const getSession = vi.fn(() => session)
    const deps = depsMock({
      activePartitions: () => {
        order.push('active')
        return ['yocim-browser-live']
      },
      disposeAll: () => order.push('dispose'),
      listPartitions: async () => {
        order.push('scan')
        return ['yocim-browser-disk', 'Default']
      },
      getSession,
      removePartition: vi.fn(async (name) => {
        order.push(`remove:${name}`)
      }),
      clearAuditFile: vi.fn(async () => {
        order.push('audit')
      })
    })

    const result = await new BrowserDataService(deps).reset()

    expect(order.slice(0, 3)).toEqual(['active', 'dispose', 'scan'])
    expect(order).toContain('audit')
    expect(order).toContain('remove:yocim-browser-disk')
    expect(order).toContain('remove:yocim-browser-live')
    expect(order).not.toContain('remove:Default')
    expect(getSession).toHaveBeenCalledWith('yocim-browser-disk')
    expect(session.clearStorageData).toHaveBeenCalledTimes(2)
    expect(session.clearStorageData).toHaveBeenCalledWith({
      storages: [...BROWSER_STORAGE_TYPES]
    })
    expect(session.clearCache).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ cleared: 2 })
  })

  it('isolates per-profile failures and does not count a failed profile as cleared', async () => {
    const badSession: BrowserStorageSession = {
      clearStorageData: vi.fn(async () => {
        throw new Error('locked')
      }),
      clearCache: vi.fn(async () => undefined)
    }
    const removePartition = vi.fn(async (name: string) => {
      if (name === 'yocim-browser-bad') throw new Error('denied')
    })

    const result = await new BrowserDataService(
      depsMock({
        listPartitions: async () => ['yocim-browser-bad', 'yocim-browser-good'],
        getSession: (name) => (name === 'yocim-browser-bad' ? badSession : sessionMock()),
        removePartition
      })
    ).reset()

    expect(removePartition).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ cleared: 1 })
  })

  it('falls back to active partitions when the disk scan fails', async () => {
    const removePartition = vi.fn(async () => undefined)
    const result = await new BrowserDataService(
      depsMock({
        listPartitions: async () => {
          throw new Error('ENOENT')
        },
        activePartitions: () => ['yocim-browser-x'],
        getSession: () => null,
        removePartition
      })
    ).reset()

    expect(removePartition).toHaveBeenCalledWith('yocim-browser-x')
    expect(result).toEqual({ cleared: 1 })
  })

  it('always clears the audit file and tolerates its failure', async () => {
    const clearAuditFile = vi.fn(async () => undefined)
    expect(await new BrowserDataService(depsMock({ clearAuditFile })).reset()).toEqual({
      cleared: 0
    })
    expect(clearAuditFile).toHaveBeenCalledOnce()

    const failing = await new BrowserDataService(
      depsMock({
        clearAuditFile: async () => {
          throw new Error('read-only')
        }
      })
    ).reset()
    expect(failing).toEqual({ cleared: 0 })
  })
})
