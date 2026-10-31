import i18next from 'i18next'
import Backend from 'i18next-fs-backend'
import * as i18nextMiddleware from 'i18next-http-middleware'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const initI18n = async () => {
  await i18next
    .use(i18nextMiddleware.LanguageDetector)
    .use(Backend)
    .init({
      fallbackLng: 'en',
      preload: ['en', 'tr'],
      supportedLngs: ['en', 'tr'],
      load: 'languageOnly',
      backend: {
        loadPath: path.resolve(__dirname, '../../../locales/{{lng}}/translation.json'),
      },
      detection: {
        order: ['header', 'querystring', 'cookie'],
        caches: false,
        lookupHeader: 'accept-language',
      },
      debug: false,
    })

  return i18nextMiddleware.handle(i18next)
}
