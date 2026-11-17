import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/** 跨组件共享的纯 UI 状态：侧栏工具条与对应面板/弹窗 */
export const useUiStore = defineStore('ui', () => {
  const terminalOpen = ref(false)
  const browserOpen = ref(false)
  const settingsOpen = ref(false)
  const conventionsOpen = ref(false)
  const commandsOpen = ref(false)
  const auditOpen = ref(false)

  /** 下半屏工具区当前 tab；两侧都可关闭整个 dock */
  const toolTab = computed<'terminal' | 'browser' | null>(() =>
    browserOpen.value ? 'browser' : terminalOpen.value ? 'terminal' : null
  )

  function toggleConventions(): void {
    conventionsOpen.value = !conventionsOpen.value
  }

  function closeConventions(): void {
    conventionsOpen.value = false
  }

  function openCommands(): void {
    commandsOpen.value = true
  }

  function closeCommands(): void {
    commandsOpen.value = false
  }

  function toggleAudit(): void {
    auditOpen.value = !auditOpen.value
  }

  function closeAudit(): void {
    auditOpen.value = false
  }

  function toggleTerminal(): void {
    const next = !terminalOpen.value
    terminalOpen.value = next
    if (next) browserOpen.value = false
  }

  function closeTerminal(): void {
    terminalOpen.value = false
  }

  /** 点击占位按钮：从终端切到浏览器；再次点击关闭浏览器 tab */
  function toggleBrowser(): void {
    const next = !browserOpen.value
    browserOpen.value = next
    if (next) terminalOpen.value = false
  }

  function closeBrowser(): void {
    browserOpen.value = false
  }

  /** 切换 tab 时保持当前面板；只有再次点侧栏按钮或点关闭才收起 */
  function activateTerminal(): void {
    terminalOpen.value = true
    browserOpen.value = false
  }

  function activateBrowser(): void {
    browserOpen.value = true
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
    browserOpen,
    toolTab,
    settingsOpen,
    conventionsOpen,
    commandsOpen,
    auditOpen,
    toggleConventions,
    closeConventions,
    openCommands,
    closeCommands,
    toggleAudit,
    closeAudit,
    toggleTerminal,
    closeTerminal,
    toggleBrowser,
    closeBrowser,
    activateTerminal,
    activateBrowser,
    openSettings,
    closeSettings
  }
})
