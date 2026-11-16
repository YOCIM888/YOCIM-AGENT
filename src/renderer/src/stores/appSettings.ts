import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { BillingSummary, ProviderBalance, StorageInfo } from '@shared/billing'
import type {
  SettingsSetImageInput,
  SettingsSetPricingInput,
  SettingsSetSearchInput,
  SettingsSetStorageInput
} from '@shared/ipc'
import {
  IMAGE_SETTINGS_DEFAULTS,
  SEARCH_SETTINGS_DEFAULTS,
  type ImageSettings,
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
  const image = ref<ImageSettings>({ ...IMAGE_SETTINGS_DEFAULTS })
  const pricing = ref<ModelPricing[]>([])
  const storage = ref<StorageSettings>({ dataDir: '' })
  const balances = ref<Record<string, ProviderBalance>>({})
  const summary = ref<BillingSummary | null>(null)
  const storageInfo = ref<StorageInfo | null>(null)
  const loading = ref(false)
  const error = ref('')
  const notice = ref('')

  const searchReady = computed(() => search.value.enabled && search.value.hasApiKey)
  const imageReady = computed(() => image.value.enabled && image.value.hasApiKey)

  function apply(settings: {
    search: SearchSettings
    image: ImageSettings
    pricing: ModelPricing[]
    storage: StorageSettings
  }): void {
    search.value = { ...settings.search }
    image.value = { ...settings.image }
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

  async function setImage(input: SettingsSetImageInput): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.setImage(input)
    if (result.ok) {
      apply(result.data)
      return true
    }
    error.value = result.error.message
    return false
  }

  async function clearImageKey(): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.clearImageKey()
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
    error.value = ''
    const result = await window.yocim.storage.pick()
    if (!result.ok) {
      error.value = result.error.message
      return null
    }
    return result.data
  }

  async function openStorageDirectory(): Promise<void> {
    const result = await window.yocim.storage.open()
    if (!result.ok) error.value = result.error.message
  }

  return {
    search,
    image,
    pricing,
    storage,
    balances,
    summary,
    storageInfo,
    loading,
    error,
    notice,
    searchReady,
    imageReady,
    refresh,
    setSearch,
    clearSearchKey,
    setImage,
    clearImageKey,
    setPricing,
    setStorage,
    fetchBalance,
    fetchSummary,
    refreshStorageInfo,
    pickStorageDirectory,
    openStorageDirectory
  }
})
