import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { applyDocumentLocale, readStoredLocale } from './i18n'
import router from './router'
import './assets/main.css'

const savedTheme = (() => {
  try {
    return localStorage.getItem('yocim.theme')
  } catch {
    return null
  }
})()
document.documentElement.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light'
applyDocumentLocale(readStoredLocale() ?? 'zh-CN')

createApp(App).use(createPinia()).use(router).mount('#app')
