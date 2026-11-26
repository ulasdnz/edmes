import { type AppCore, AppCoreProvider, createAppCore } from '@mes/frontend/core'
import { createI18n, type Language } from '@mes/frontend/i18n'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import { en } from '../locales/en'
import { tr } from '../locales/tr'

export function renderWithI18n(node: ReactNode, language: Language = 'en') {
  const i18n = createI18n({ language, resources: { en, tr } })
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

// The app's own core (API client, query client, session), with nothing signed in and storage of
// its own
export function createTestCore(): AppCore {
  sessionStorage.clear()
  return createAppCore({
    app: 'web',
    storage: sessionStorage,
    getLocale: () => 'en',
    storageEvents: new EventTarget(),
  })
}

// A rerender keeps the providers: they are the wrapper, not part of the node
export function renderInApp(
  node: ReactNode,
  options: { language?: Language; core?: AppCore; router?: boolean } = {},
) {
  const i18n = createI18n({ language: options.language ?? 'en', resources: { en, tr } })
  const core = options.core ?? createTestCore()
  const wrapper = (props: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <AppCoreProvider core={core}>{props.children}</AppCoreProvider>
    </I18nextProvider>
  )
  if (!options.router) return render(node, { wrapper })
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/users'] }),
  })
  return render(<RouterProvider router={router} />, { wrapper })
}
