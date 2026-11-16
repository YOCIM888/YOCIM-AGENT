import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  ProviderSaveInput,
  SettingsResult,
  SettingsSetContextWindowInput,
  SettingsSetReasoningEffortInput
} from '@shared/ipc'
import { resolveContextWindow, resolveReasoningEffort } from '@shared/providers'
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

  /** 当前激活模型的上下文窗口（token），用于用量圆环与压缩 */
  const contextWindow = computed(() =>
    resolveContextWindow(activeProvider.value, activeModel.value)
  )

  /** 当前激活模型的思考强度（模型菜单可调，default 不发思考参数） */
  const reasoningEffort = computed(() =>
    resolveReasoningEffort(activeProvider.value, activeModel.value)
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

  async function setContextWindow(input: SettingsSetContextWindowInput): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.setContextWindow(input)
    if (result.ok) {
      apply(result.data)
      return true
    }
    error.value = result.error.message
    return false
  }

  async function setReasoningEffort(input: SettingsSetReasoningEffortInput): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.setReasoningEffort(input)
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
    contextWindow,
    reasoningEffort,
    loading,
    error,
    refresh,
    saveProvider,
    removeProvider,
    setActive,
    setContextWindow,
    setReasoningEffort
  }
})
