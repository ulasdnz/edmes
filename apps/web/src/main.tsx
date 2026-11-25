import { AppCoreProvider, createAppCore } from '@mes/frontend/core'
import { createI18n, resolveLanguage } from '@mes/frontend/i18n'
import { installChunkReloadGuard, startVersionCheck } from '@mes/frontend/version'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { toast } from 'sonner'
import './app.css'
import { en } from './locales/en'
import { tr } from './locales/tr'
import { readLanguage } from './prefs'
import { createAppRouter } from './router'

function deviceLanguage(user?: string) {
  let stored: string | null = null
  try {
    stored = readLanguage(localStorage)
  } catch {
    // no device storage: the browser's language decides
  }
  return resolveLanguage({ user, stored, browser: navigator.language })
}

const i18n = createI18n({ language: deviceLanguage(), resources: { en, tr } })
document.documentElement.lang = i18n.language
i18n.on('languageChanged', language => {
  document.documentElement.lang = language
})

const core = createAppCore({ app: 'web', storage: localStorage, getLocale: () => i18n.language })
const router = createAppRouter(core)

// A session that ends, or permissions that change, rerun the route guards of the open page.
let previous = core.session.getState()
core.session.subscribe(state => {
  const ended = state.status === 'anonymous' && previous.status !== 'anonymous'
  const permissionsChanged = state.permissions.join() !== previous.permissions.join()
  previous = state
  const language = deviceLanguage(state.user?.language)
  if (language !== i18n.language) void i18n.changeLanguage(language)
  if (ended || permissionsChanged) void router.invalidate()
})

installChunkReloadGuard({ storage: sessionStorage, reload: () => window.location.reload() })
startVersionCheck({
  currentVersion: __APP_VERSION__,
  url: '/version.json',
  onMismatch: () => {
    toast(i18n.t('version.available'), {
      duration: Number.POSITIVE_INFINITY,
      action: { label: i18n.t('version.reload'), onClick: () => window.location.reload() },
    })
  },
})

await core.session.bootstrap()

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')
createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <AppCoreProvider core={core}>
        <RouterProvider router={router} />
      </AppCoreProvider>
    </I18nextProvider>
  </StrictMode>,
)
