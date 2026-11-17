<script setup lang="ts">
import { t, type Locale } from '../i18n'

const emit = defineEmits<{
  select: [locale: Locale]
}>()

function choose(locale: Locale): void {
  emit('select', locale)
}
</script>

<template>
  <div class="overlay" data-testid="language-onboarding">
    <section class="dialog" role="dialog" :aria-label="t('选择语言')">
      <div class="brand" aria-hidden="true">Y</div>
      <h1>{{ t('选择语言') }}</h1>
      <p class="subtitle">{{ t('选择 YOCIM AGENT 的界面语言，稍后可在设置中更改。') }}</p>

      <div class="options">
        <button
          type="button"
          class="option"
          data-testid="language-option-zh-CN"
          @click="choose('zh-CN')"
        >
          <span class="option-title">简体中文</span>
          <span class="option-sub">{{ t('中文界面') }}</span>
        </button>
        <button type="button" class="option" data-testid="language-option-en" @click="choose('en')">
          <span class="option-title">English</span>
          <span class="option-sub">{{ t('English interface') }}</span>
        </button>
      </div>

      <p class="hint">{{ t('下一步将打开模型设置，请填写 API Key 以开始使用。') }}</p>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: var(--bg);
  -webkit-app-region: no-drag;
}

.dialog {
  width: min(520px, calc(100vw - 48px));
  padding: 32px 34px 26px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  text-align: center;
}

.brand {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: 0 auto 18px;
  border-radius: 12px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 20px;
  font-weight: 700;
}

h1 {
  margin: 0 0 8px;
  font-size: 19px;
  font-weight: 600;
}

.subtitle {
  margin: 0 0 24px;
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.6;
}

.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.option {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
  color: var(--text);
  font: inherit;
  cursor: pointer;
  transition:
    border-color 130ms ease,
    background-color 130ms ease;
}

.option:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.option-title {
  font-size: 14px;
  font-weight: 600;
}

.option-sub {
  color: var(--text-muted);
  font-size: 11px;
}

.hint {
  margin: 22px 0 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.6;
}
</style>
