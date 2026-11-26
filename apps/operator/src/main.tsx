import { AppCoreProvider, createAppCore } from '@mes/frontend/core'
import { createI18n, resolveLanguage } from '@mes/frontend/i18n'
import { installChunkReloadGuard, reloadWhenIdle, startVersionCheck } from '@mes/frontend/version'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import './app.css'
import { en } from './locales/en'
import { tr } from './locales/tr'
import { createAppRouter } from './router'
import { followAssignments } from './station/follow-assignments'
import { createStationStore, stationRoom } from './station/station-store'

const deviceLanguage = (user?: string) => resolveLanguage({ user, browser: navigator.language })

const i18n = createI18n({ language: deviceLanguage(), resources: { en, tr } })
document.documentElement.lang = i18n.language
i18n.on('languageChanged', language => {
  document.documentElement.lang = language
})

const station = createStationStore(localStorage)

const core = createAppCore({
  app: 'operator',
  storage: localStorage,
  getLocale: () => i18n.language,
  // The gateway refused the station's room: the work center is no longer the user's.
  onRoomsDenied: denied => {
    const workCenterId = station.getWorkCenterId()
    if (workCenterId === null || !denied.includes(stationRoom(workCenterId))) return
    station.clear()
    void router.navigate({ to: '/select-work-center', replace: true })
  },
})
const router = createAppRouter(core, station)
followAssignments(core, station)

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

installChunkReloadGuard({
  storage: sessionStorage,
  reload: () => window.location.reload(),
  version: __APP_VERSION__,
})

// Nobody may be at the tablet to press reload: a new version loads once nothing is in progress.
startVersionCheck({
  currentVersion: __APP_VERSION__,
  url: `${import.meta.env.BASE_URL}version.json`,
  onMismatch: () => {
    reloadWhenIdle({
      isBusy: () =>
        core.queryClient.isMutating() > 0 || document.querySelector('[role="dialog"]') !== null,
      reload: () => location.reload(),
    })
  },
})

// The route guards wait for this; the first render does not.
void core.session.bootstrap()

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
