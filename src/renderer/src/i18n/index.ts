import { ref } from 'vue'
import en from './en'
import es from './es'
import ja from './ja'
import ko from './ko'
import ptBR from './pt'

/** 应用界面语言。中文为源语言（键即中文原文），其余语言为翻译。 */
export type Locale = 'zh-CN' | 'en' | 'ja' | 'ko' | 'es' | 'pt-BR'

export interface LocaleOption {
  value: Locale
  /** 语言自称，始终以该语言原文显示 */
  label: string
  /** 语言说明的翻译键 */
  subtitleKey: string
}

/** 语言选项的唯一来源，设置面板与首启引导共用。 */
export const LOCALES: readonly LocaleOption[] = [
  { value: 'zh-CN', label: '简体中文', subtitleKey: '中文界面' },
  { value: 'en', label: 'English', subtitleKey: '英语界面' },
  { value: 'ja', label: '日本語', subtitleKey: '日语界面' },
  { value: 'ko', label: '한국어', subtitleKey: '韩语界面' },
  { value: 'es', label: 'Español', subtitleKey: '西班牙语界面' },
  { value: 'pt-BR', label: 'Português (Brasil)', subtitleKey: '巴西葡萄牙语界面' }
]

const dictionaries: Record<Exclude<Locale, 'zh-CN'>, Record<string, string>> = {
  en,
  ja,
  ko,
  es,
  'pt-BR': ptBR
}

export const LOCALE_STORAGE_KEY = 'yocim.locale'
export const DEFAULT_LOCALE: Locale = 'zh-CN'

export function isLocale(value: string | null | undefined): value is Locale {
  return LOCALES.some((item) => item.value === value)
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
  // 个别语言缺译时回退到英文，再回退到中文原文
  const template =
    locale.value === 'zh-CN' ? key : (dictionaries[locale.value][key] ?? en[key] ?? key)
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}
