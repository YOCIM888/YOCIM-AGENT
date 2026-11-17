<script setup lang="ts">
import { t } from '../../i18n'
import type { Locale } from '../../i18n'
import { computed } from 'vue'
import { FONT_SIZE_MAX, FONT_SIZE_MIN, useSettingsStore } from '../../stores/settings'

const store = useSettingsStore()

const locale = computed<Locale>({
  get: () => store.locale,
  set: (value) => store.setLocale(value)
})
const theme = computed({
  get: () => store.theme,
  set: (value: 'light' | 'dark') => store.setTheme(value)
})
const fontSize = computed({
  get: () => store.fontSize,
  set: (value: number) => store.setFontSize(value)
})
const wordWrap = computed({
  get: () => store.wordWrap,
  set: (value: 'on' | 'off') => store.setWordWrap(value)
})
const minimap = computed({
  get: () => store.minimap,
  set: (value: boolean) => store.setMinimap(value)
})
</script>

<template>
  <div class="sp-panel">
    <section class="sp-section">
      <h3 class="sp-section-title">{{ t('语言') }}</h3>
      <p class="sp-section-sub">{{ t('界面语言立即生效，无需重启。') }}</p>
      <div class="sp-row compact">
        <label class="sp-field">
          <span>{{ t('界面语言') }}</span>
          <select v-model="locale" data-testid="appearance-language">
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
    </section>

    <section class="sp-section">
      <h3 class="sp-section-title">{{ t('主题') }}</h3>
      <p class="sp-section-sub">{{ t('界面配色，立即生效并记住选择。') }}</p>
      <div class="sp-row compact">
        <label class="sp-field">
          <span>{{ t('配色模式') }}</span>
          <select v-model="theme" data-testid="appearance-theme">
            <option value="light">{{ t('浅色') }}</option>
            <option value="dark">{{ t('深色') }}</option>
          </select>
        </label>
      </div>
    </section>

    <section class="sp-section">
      <h3 class="sp-section-title">{{ t('编辑器') }}</h3>
      <p class="sp-section-sub">{{ t('代码编辑区的显示偏好。') }}</p>
      <div class="sp-row compact">
        <label class="sp-field">
          <span>{{ t('字体大小') }}</span>
          <input
            v-model.number="fontSize"
            type="number"
            :min="FONT_SIZE_MIN"
            :max="FONT_SIZE_MAX"
            data-testid="appearance-font-size"
          />
        </label>
        <label class="sp-field">
          <span>{{ t('自动换行') }}</span>
          <select v-model="wordWrap" data-testid="appearance-word-wrap">
            <option value="off">{{ t('不换行') }}</option>
            <option value="on">{{ t('换行') }}</option>
          </select>
        </label>
      </div>
      <label class="sp-check">
        <input v-model="minimap" type="checkbox" data-testid="appearance-minimap" />
        {{ t('显示代码缩略图') }}
      </label>
    </section>

    <p class="sp-hint">{{ t('外观偏好保存在本地，不影响会话与模型配置。') }}</p>
  </div>
</template>
