import i18next, { type i18n } from 'i18next'
import type { Language } from './resolve-language'
import { turkishAblativeSuffix } from './turkish-ablative'

export { commonEn } from './common.en'
export { commonTr } from './common.tr'
export { type Language, resolveLanguage } from './resolve-language'
export { turkishAblativeSuffix } from './turkish-ablative'

export function createI18n(options: {
  language: Language
  resources: Record<Language, object>
}): i18n {
  const instance = i18next.createInstance()
  void instance.init({
    lng: options.language,
    fallbackLng: 'en',
    supportedLngs: ['en', 'tr'],
    resources: {
      en: { translation: options.resources.en },
      tr: { translation: options.resources.tr },
    },
    initAsync: false,
    interpolation: { escapeValue: false },
  })
  // "{{time, ablative}}" in a Turkish string: the suffix the time takes, "10:31" → "den"
  instance.services.formatter?.add('ablative', value => turkishAblativeSuffix(String(value)))
  return instance
}
