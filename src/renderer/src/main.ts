import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
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

createApp(App).use(createPinia()).use(router).mount('#app')
