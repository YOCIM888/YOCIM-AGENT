import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { BillingSummary, ProviderBalance, StorageInfo } from '@shared/billing'
import type {
  SettingsSetPricingInput,
  SettingsSetSearchInput,
  SettingsSetStorageInput
} from '@shared/ipc'
import {
  SEARCH_SETTINGS_DEFAULTS,
  type ModelPricing,
  type SearchSettings,
  type StorageSettings
} from '@shared/settings'

/**
 * 设置面板里「搜索 / 账单 / 存储」三块的共享状态。
 * Provider 相关的状态在 providers store 里。
 */
export const useAppSettingsStore = defineStore('appSettings', () => {
  const search = ref<SearchSettings>({ ...SEARCH_SETTINGS_DEFAULTS })
  const pricing = ref<ModelPricing[]>([])
  const storage = ref<StorageSettings>({ dataDir: '' })
  const balances = ref<Record<string, ProviderBalance>>({})
  const summary = ref<BillingSummary | null>(null)
  const storageInfo = ref<StorageInfo | null>(null)
  const loading = ref(false)
  const error = ref('')
  const notice = ref('')

  const searchReady = computed(() => search.value.enabled && search.value.hasApiKey)

  function apply(settings: {
    search: SearchSettings
    pricing: ModelPricing[]
    storage: StorageSettings
  }): void {
    search.value = { ...settings.search }
    pricing.value = settings.pricing.map((item) => ({ ...item }))
    storage.value = { ...settings.storage }
  }

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const result = await window.yocim.settings.get()
      if (result.ok) {
        apply(result.data)
      } else {
        error.value = result.error.message
      }
    } finally {
      loading.value = false
    }
  }

  async function setSearch(input: SettingsSetSearchInput): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.setSearch(input)
    if (result.ok) {
      apply(result.data)
      return true
    }
    error.value = result.error.message
    return false
  }

  async function clearSearchKey(): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.clearSearchKey()
    if (result.ok) {
      apply(result.data)
      return true
    }
    error.value = result.error.message
    return false
  }

  async function setPricing(input: SettingsSetPricingInput): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.setPricing(input)
    if (result.ok) {
      apply(result.data)
      return true
    }
    error.value = result.error.message
    return false
  }

  async function setStorage(input: SettingsSetStorageInput): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.setStorage(input)
    if (result.ok) {
      apply(result.data)
      await refreshStorageInfo()
      return true
    }
    error.value = result.error.message
    return false
  }

  async function fetchBalance(providerId: string): Promise<ProviderBalance | null> {
    error.value = ''
    const result = await window.yocim.billing.getBalance({ providerId })
    if (!result.ok) {
      error.value = result.error.message
      return null
    }
    balances.value = { ...balances.value, [providerId]: result.data }
    return result.data
  }

  async function fetchSummary(sinceDays?: number): Promise<void> {
    loading.value = true
    try {
      const result = await window.yocim.billing.getSummary(sinceDays ? { sinceDays } : {})
      if (result.ok) {
        summary.value = result.data
      } else {
        error.value = result.error.message
      }
    } finally {
      loading.value = false
    }
  }

  async function refreshStorageInfo(): Promise<void> {
    const result = await window.yocim.storage.info()
    if (result.ok) storageInfo.value = result.data
  }

  async function pickStorageDirectory(): Promise<string | null> {
    const result = await window.yocim.storage.pick()
    return result.ok ? result.data : null
  }

  async function openStorageDirectory(): Promise<void> {
    const result = await window.yocim.storage.open()
    if (!result.ok) error.value = result.error.message
  }

  return {
    search,
    pricing,
    storage,
    balances,
    summary,
    storageInfo,
    loading,
    error,
    notice,
    searchReady,
    refresh,
    setSearch,
    clearSearchKey,
    setPricing,
    setStorage,
    fetchBalance,
    fetchSummary,
    refreshStorageInfo,
    pickStorageDirectory,
    openStorageDirectory
  }
})
