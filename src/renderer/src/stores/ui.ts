import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 跨组件共享的纯 UI 状态：侧栏工具条与对应面板/弹窗 */
export const useUiStore = defineStore('ui', () => {
  const terminalOpen = ref(false)
  const settingsOpen = ref(false)
  const conventionsOpen = ref(false)

  function toggleConventions(): void {
    conventionsOpen.value = !conventionsOpen.value
  }

  function closeConventions(): void {
    conventionsOpen.value = false
  }

  function toggleTerminal(): void {
    terminalOpen.value = !terminalOpen.value
  }

  function closeTerminal(): void {
    terminalOpen.value = false
  }

  function openSettings(): void {
    settingsOpen.value = true
  }

  function closeSettings(): void {
    settingsOpen.value = false
  }

  return {
    terminalOpen,
    settingsOpen,
    conventionsOpen,
    toggleConventions,
    closeConventions,
    toggleTerminal,
    closeTerminal,
    openSettings,
    closeSettings
  }
})
