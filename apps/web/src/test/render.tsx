import { createI18n } from '@mes/frontend/i18n'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import { en } from '../locales/en'
import { tr } from '../locales/tr'

export function renderWithI18n(node: ReactNode) {
  const i18n = createI18n({ language: 'en', resources: { en, tr } })
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}
