import i18next, { type i18n } from 'i18next'
import type { Language } from './resolve-language'

export { commonEn } from './common.en'
export { commonTr } from './common.tr'
export { type Language, resolveLanguage } from './resolve-language'

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
  return instance
}
