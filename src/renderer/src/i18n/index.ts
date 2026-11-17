import { ref } from 'vue'
import en from './en'

/** 应用界面语言。中文为源语言（键即中文原文），英文为翻译。 */
export type Locale = 'zh-CN' | 'en'

export const LOCALE_STORAGE_KEY = 'yocim.locale'
export const DEFAULT_LOCALE: Locale = 'zh-CN'

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'zh-CN' || value === 'en'
}

export function readStoredLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(value) ? value : null
  } catch {
    return null
  }
}

/** 早于 Vue 挂载调用，避免首屏语言闪烁。 */
export function applyDocumentLocale(value: Locale): void {
  document.documentElement.lang = value
}

export const locale = ref<Locale>(readStoredLocale() ?? DEFAULT_LOCALE)

applyDocumentLocale(locale.value)

export function setLocale(next: Locale): void {
  locale.value = next
  applyDocumentLocale(next)
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
  } catch {
    // 本地偏好写入失败不影响使用
  }
}

/** 翻译函数。读取 locale.value 使模板/计算属性能跟随语言切换自动更新。 */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = locale.value === 'en' ? (en[key] ?? key) : key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}
