<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import { useAppSettingsStore } from '../../stores/appSettings'
import { useBrowserStore } from '../../stores/browser'
import type { BrowserSettings } from '@shared/settings'

const appSettings = useAppSettingsStore()
const browserStore = useBrowserStore()

const form = ref<BrowserSettings>({
  enabled: true,
  headless: false,
  idleRecycleMinutes: 30,
  allowEvaluate: true,
  inheritProfile: false
})
const saving = ref(false)
const notice = ref('')
const confirmInherit = ref(false)
const confirmReset = ref(false)
const resetting = ref(false)
const resetNotice = ref('')

watch(
  () => appSettings.browser,
  (next) => {
    form.value = { ...next }
  },
  { immediate: true, deep: true }
)

const inheritRisk = computed(() => form.value.inheritProfile)

onMounted(() => {
  void appSettings.refresh()
})

async function save(): Promise<void> {
  saving.value = true
  notice.value = ''
  try {
    const ok = await appSettings.setBrowser({ ...form.value })
    notice.value = ok ? '浏览器设置已保存' : appSettings.error || '保存失败'
  } finally {
    saving.value = false
  }
}

function onInheritChange(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  if (checked && !appSettings.browser.inheritProfile) {
    // 显式风险确认：勾选后弹出确认框，取消则回退
    confirmInherit.value = true
    form.value.inheritProfile = false
    return
  }
  form.value.inheritProfile = checked
}

function confirmInheritProfile(): void {
  form.value.inheritProfile = true
  confirmInherit.value = false
}

async function resetBrowser(): Promise<void> {
  confirmReset.value = false
  resetting.value = true
  resetNotice.value = ''
  try {
    const response = await window.yocim.browser.reset()
    if (!response.ok) {
      resetNotice.value = `重置失败：${response.error.message}`
      return
    }
    browserStore.reset(browserStore.state?.sessionId ?? null)
    resetNotice.value = `已清理 ${response.data.cleared} 个独立浏览器配置；下次打开浏览器 tab 会重新创建。`
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <div class="sp-panel">
    <section class="sp-section">
      <div class="sp-section-head">
        <h3 class="sp-section-title">浏览器</h3>
        <span class="badge">AI 可操作</span>
      </div>
      <p class="sp-section-sub">
        Agent 通过 Chrome DevTools Protocol 直接操作内置浏览器；页面在下半屏工具区的「浏览器」tab
        中可见。控制流走现有 Agent 工具链，可随时暂停、接管与恢复。
      </p>
    </section>

    <section class="sp-section">
      <label class="sp-check">
        <input v-model="form.enabled" type="checkbox" />
        <span>允许 AI 使用浏览器工具（关闭后工具不暴露给模型，UI 仍可人工打开查看）</span>
      </label>
      <label class="sp-check">
        <input v-model="form.headless" type="checkbox" />
        <span>无头模式（页面在后台运行并可通过 CDP 操作；UI 会标识，默认有头可见）</span>
      </label>
      <label class="sp-check">
        <input v-model="form.allowEvaluate" type="checkbox" />
        <span>允许受限 Runtime.evaluate（已禁止访问 Node / Electron / 文件系统）</span>
      </label>
      <label class="sp-check">
        <input
          type="checkbox"
          :checked="form.inheritProfile"
          @change="onInheritChange"
        />
        <span>
          复用日常浏览器 profile 登录态（<strong>高风险</strong>：AI 将以你的登录身份操作页面，
          建议保持关闭以使用独立 profile）
        </span>
      </label>
      <p v-if="inheritRisk" class="sp-error">
        已勾选复用日常 profile：保存后浏览器将使用你的登录态，请确认你理解相关风险。
      </p>

      <div class="sp-row compact">
        <label class="sp-field">
          <span>空闲回收时间（分钟，0 表示不回收）</span>
          <input v-model.number="form.idleRecycleMinutes" type="number" min="0" max="1440" />
        </label>
      </div>
      <p class="sp-hint">
        回收前会写入 append-only 审计日志；tab 切换仅隐藏视图、不销毁会话，滚动/运行状态保留。
      </p>
    </section>

    <div class="actions">
      <button type="button" class="sp-btn primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <span v-if="notice" class="sp-hint">{{ notice }}</span>
    </div>

    <section class="sp-section danger-zone">
      <h3 class="sp-section-title">清除浏览器数据</h3>
      <p class="sp-section-sub">
        关闭所有浏览器页面，清除独立 profile 的 Cookie、本地存储、缓存与浏览审计记录。
        日常浏览器的登录态不会被删除（即使启用了 profile 复用）。此操作不可撤销。
      </p>
      <div class="sp-row">
        <button
          type="button"
          class="sp-btn"
          data-testid="browser-reset"
          :disabled="resetting"
          @click="confirmReset = true"
        >
          {{ resetting ? '清理中…' : '清除数据并重置浏览器' }}
        </button>
        <span v-if="resetNotice" class="sp-hint">{{ resetNotice }}</span>
      </div>
    </section>

    <ConfirmDialog
      v-if="confirmInherit"
      title="确认复用日常登录态？"
      message="启用后，内置浏览器会复用你的日常 profile（含 Cookie 与登录状态）。AI 操作页面时将以你的身份进行，可能触发真实账户操作。请确认只在你充分信任的场景下启用。"
      confirm-label="我已知晓并启用"
      danger
      testid="browser-inherit-confirm"
      @confirm="confirmInheritProfile"
      @close="confirmInherit = false"
    />

    <ConfirmDialog
      v-if="confirmReset"
      title="清除浏览器数据？"
      message="将关闭所有浏览器页面，删除本应用为会话创建的独立浏览器 profile（Cookie、本地存储、缓存）并清空浏览审计。日常浏览器的登录态不会被删除。此操作不可撤销。"
      confirm-label="清除并重置"
      danger
      testid="browser-reset-confirm"
      @confirm="resetBrowser"
      @close="confirmReset = false"
    />
  </div>
</template>

<style scoped>
.badge {
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--success) 45%, var(--border));
  border-radius: 999px;
  background: var(--success-soft);
  color: var(--success);
  font-size: 10.5px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
}
.danger-zone {
  border-top: 1px solid var(--border);
}
.danger-zone .sp-btn {
  color: var(--danger);
}
</style>
