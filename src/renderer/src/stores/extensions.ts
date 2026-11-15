import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  ExtensionContributionBundle,
  ExtensionInfo,
  VscodeExtensionCandidate,
  VscodeScanResult
} from '@shared/extensions'

export const useExtensionsStore = defineStore('extensions', () => {
  const list = ref<ExtensionInfo[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  const scan = ref<VscodeScanResult | null>(null)
  const scanning = ref(false)
  const busyId = ref<string | null>(null)
  const contributions = ref<ExtensionContributionBundle>({
    commands: [],
    snippets: [],
    grammars: [],
    version: 0
  })
  const detailId = ref<string | null>(null)

  const enabledCount = computed(() => list.value.filter((item) => item.enabled).length)
  const candidates = computed<VscodeExtensionCandidate[]>(() => scan.value?.candidates ?? [])
  const detail = computed(() => list.value.find((item) => item.id === detailId.value) ?? null)

  async function refreshContributions(): Promise<void> {
    const result = await window.yocim.extensions.contributions()
    if (result.ok) contributions.value = result.data
  }

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const result = await window.yocim.extensions.list()
      if (!result.ok) {
        error.value = result.error.message
        return
      }
      list.value = result.data
      error.value = null
      await refreshContributions()
    } finally {
      loading.value = false
    }
  }

  function afterMutation(
    result: { ok: true; data: ExtensionInfo[] } | { ok: false; error: { message: string } }
  ): boolean {
    if (!result.ok) {
      error.value = result.error.message
      return false
    }
    list.value = result.data
    error.value = null
    void refreshContributions()
    return true
  }

  async function installLocal(directory?: string): Promise<boolean> {
    busyId.value = 'install-local'
    notice.value = null
    try {
      const result = await window.yocim.extensions.installLocal(directory ? { directory } : {})
      if (!result.ok) {
        error.value = result.error.message
        return false
      }
      notice.value = result.data.notice ?? `已安装 ${result.data.extension.displayName}`
      await refresh()
      return true
    } finally {
      busyId.value = null
    }
  }

  async function installVsix(filePath?: string): Promise<boolean> {
    busyId.value = 'install-vsix'
    notice.value = null
    try {
      const result = await window.yocim.extensions.installVsix(filePath ? { filePath } : {})
      if (!result.ok) {
        error.value = result.error.message
        return false
      }
      notice.value = result.data.notice ?? `已安装 ${result.data.extension.displayName}`
      await refresh()
      return true
    } finally {
      busyId.value = null
    }
  }

  async function scanVscode(directory?: string): Promise<void> {
    scanning.value = true
    try {
      const result = await window.yocim.extensions.scanVscode(directory ? { directory } : {})
      if (!result.ok) {
        error.value = result.error.message
        scan.value = null
        return
      }
      scan.value = result.data
      error.value = result.data.error ?? null
    } finally {
      scanning.value = false
    }
  }

  async function importVscode(id: string): Promise<boolean> {
    busyId.value = id
    notice.value = null
    try {
      const result = await window.yocim.extensions.importVscode({ id })
      if (!result.ok) {
        error.value = result.error.message
        return false
      }
      notice.value = result.data.notice ?? `已导入 ${result.data.extension.displayName}`
      await refresh()
      await scanVscode(scan.value?.directory)
      return true
    } finally {
      busyId.value = null
    }
  }

  async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
    busyId.value = id
    notice.value = null
    try {
      return afterMutation(await window.yocim.extensions.setEnabled({ id, enabled }))
    } finally {
      busyId.value = null
    }
  }

  async function uninstall(id: string): Promise<boolean> {
    busyId.value = id
    notice.value = null
    try {
      const ok = afterMutation(await window.yocim.extensions.uninstall({ id }))
      if (ok && detailId.value === id) detailId.value = null
      return ok
    } finally {
      busyId.value = null
    }
  }

  async function reveal(id: string): Promise<void> {
    await window.yocim.extensions.reveal({ id })
  }

  function toggleDetail(id: string): void {
    detailId.value = detailId.value === id ? null : id
  }

  function clearNotice(): void {
    notice.value = null
  }

  function reset(): void {
    list.value = []
    scan.value = null
    error.value = null
    notice.value = null
    detailId.value = null
  }

  return {
    list,
    loading,
    error,
    notice,
    scan,
    scanning,
    busyId,
    contributions,
    detailId,
    detail,
    enabledCount,
    candidates,
    refresh,
    refreshContributions,
    installLocal,
    installVsix,
    scanVscode,
    importVscode,
    setEnabled,
    uninstall,
    reveal,
    toggleDetail,
    clearNotice,
    reset
  }
})
