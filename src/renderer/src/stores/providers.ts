import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ProviderSaveInput, SettingsResult } from '@shared/ipc'
import type { PublicProvider } from '@shared/providers'

export const useProvidersStore = defineStore('providers', () => {
  const providers = ref<PublicProvider[]>([])
  const activeProviderId = ref('mock')
  const activeModel = ref('mock')
  const loading = ref(false)
  const error = ref('')

  const activeProvider = computed(
    () => providers.value.find((provider) => provider.id === activeProviderId.value) ?? null
  )

  function apply(settings: SettingsResult): void {
    providers.value = settings.providers
    activeProviderId.value = settings.activeProviderId
    activeModel.value = settings.activeModel
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

  async function saveProvider(input: ProviderSaveInput): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.saveProvider(input)
    if (result.ok) {
      apply(result.data)
      return true
    }
    error.value = result.error.message
    return false
  }

  async function removeProvider(providerId: string): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.removeProvider({ providerId })
    if (result.ok) {
      apply(result.data)
      return true
    }
    error.value = result.error.message
    return false
  }

  async function setActive(providerId: string, model: string): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.setActive({ providerId, model })
    if (result.ok) {
      apply(result.data)
      return true
    }
    error.value = result.error.message
    return false
  }

  return {
    providers,
    activeProviderId,
    activeModel,
    activeProvider,
    loading,
    error,
    refresh,
    saveProvider,
    removeProvider,
    setActive
  }
})
