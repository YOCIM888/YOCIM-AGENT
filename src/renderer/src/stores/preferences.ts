import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ApprovalMode } from '@shared/approval'

export const usePreferencesStore = defineStore('preferences', () => {
  const approvalMode = ref<ApprovalMode>('auto')
  const error = ref('')

  async function refresh(): Promise<void> {
    const result = await window.yocim.settings.get()
    if (result.ok) {
      approvalMode.value = result.data.approvalMode
    } else {
      error.value = result.error.message
    }
  }

  async function setApprovalMode(mode: ApprovalMode): Promise<boolean> {
    error.value = ''
    const result = await window.yocim.settings.setApprovalMode({ mode })
    if (result.ok) {
      approvalMode.value = result.data.approvalMode
      return true
    }
    error.value = result.error.message
    return false
  }

  return {
    approvalMode,
    error,
    refresh,
    setApprovalMode
  }
})
