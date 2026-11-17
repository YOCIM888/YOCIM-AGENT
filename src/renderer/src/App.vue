<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import LanguageOnboardingDialog from './components/LanguageOnboardingDialog.vue'
import UpdateNotice from './components/UpdateNotice.vue'
import type { Locale } from './i18n'
import { useSettingsStore } from './stores/settings'
import { useUiStore } from './stores/ui'
import { useUpdateStore } from './stores/update'

const update = useUpdateStore()
const settings = useSettingsStore()
const ui = useUiStore()
const showLanguageOnboarding = ref(!settings.languageOnboarded)

function selectLanguage(next: Locale): void {
  settings.setLocale(next)
  settings.completeLanguageOnboarding()
  showLanguageOnboarding.value = false
  ui.openSettings('models', true)
}

onMounted(() => update.listen())
onUnmounted(() => update.stop())
</script>

<template>
  <RouterView />
  <UpdateNotice />
  <LanguageOnboardingDialog v-if="showLanguageOnboarding" @select="selectLanguage" />
</template>
