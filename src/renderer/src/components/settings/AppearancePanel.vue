<script setup lang="ts">
import { computed } from 'vue'
import { FONT_SIZE_MAX, FONT_SIZE_MIN, useSettingsStore } from '../../stores/settings'

const store = useSettingsStore()

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
      <h3 class="sp-section-title">主题</h3>
      <p class="sp-section-sub">界面配色，立即生效并记住选择。</p>
      <div class="sp-row compact">
        <label class="sp-field">
          <span>配色模式</span>
          <select v-model="theme" data-testid="appearance-theme">
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
      </div>
    </section>

    <section class="sp-section">
      <h3 class="sp-section-title">编辑器</h3>
      <p class="sp-section-sub">代码编辑区的显示偏好。</p>
      <div class="sp-row compact">
        <label class="sp-field">
          <span>字体大小</span>
          <input
            v-model.number="fontSize"
            type="number"
            :min="FONT_SIZE_MIN"
            :max="FONT_SIZE_MAX"
            data-testid="appearance-font-size"
          />
        </label>
        <label class="sp-field">
          <span>自动换行</span>
          <select v-model="wordWrap" data-testid="appearance-word-wrap">
            <option value="off">关闭</option>
            <option value="on">开启</option>
          </select>
        </label>
      </div>
      <label class="sp-check">
        <input v-model="minimap" type="checkbox" data-testid="appearance-minimap" />
        显示代码缩略图
      </label>
    </section>

    <p class="sp-hint">外观偏好保存在本地，不影响会话与模型配置。</p>
  </div>
</template>
