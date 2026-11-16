import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UpdateCheckResult, UpdateInfo } from '../../../shared/update'

const DISMISSED_KEY = 'yocim.update.dismissed'

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

function writeDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version)
  } catch {
    // 隐私模式下写入失败：最多下次启动再提醒一次，不影响主流程
  }
}

export const useUpdateStore = defineStore('update', () => {
  const info = ref<UpdateInfo | null>(null)
  const toast = ref('')
  const checking = ref(false)
  let stopListening: (() => void) | null = null

  const hasNotice = computed(() => info.value !== null)

  function show(incoming: UpdateInfo, ignoreDismissed = false): void {
    if (!ignoreDismissed && readDismissed() === incoming.version) return
    info.value = incoming
  }

  function listen(): void {
    if (stopListening) return
    stopListening = window.yocim.update.onAvailable((incoming) => show(incoming))
  }

  function stop(): void {
    stopListening?.()
    stopListening = null
  }

  async function check(): Promise<void> {
    if (checking.value) return
    checking.value = true
    try {
      const response = await window.yocim.update.check()
      if (!response.ok) {
        toast.value = `检查更新失败：${response.error.message}`
        return
      }
      const result: UpdateCheckResult = response.data
      if (result.status === 'available') {
        // 用户主动检查时即使之前忽略过该版本，也要重新展示
        show(result.info, true)
      } else if (result.status === 'current') {
        toast.value = `已是最新版本（${result.currentVersion}）`
      } else if (result.status === 'offline') {
        toast.value = '当前离线，无法检查更新'
      } else {
        toast.value = result.message
      }
    } finally {
      checking.value = false
    }
  }

  function dismiss(): void {
    if (info.value) writeDismissed(info.value.version)
    info.value = null
  }

  async function openDownload(): Promise<void> {
    const current = info.value
    if (!current) return
    const response = await window.yocim.update.openDownload({ url: current.downloadUrl })
    if (!response.ok) {
      toast.value = `打开下载页面失败：${response.error.message}`
      return
    }
    dismiss()
  }

  function clearToast(): void {
    toast.value = ''
  }

  return {
    info,
    toast,
    checking,
    hasNotice,
    listen,
    stop,
    check,
    dismiss,
    openDownload,
    clearToast
  }
})
