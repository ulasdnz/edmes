import { ApiError } from '@mes/api-client'
import { createI18n } from '@mes/frontend/i18n'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../locales/en'
import { tr } from '../locales/tr'
import { renderWithI18n } from '../test/render'
import { apiErrorMessage, NoPermission, PageError } from './page-state'

describe('page states', () => {
  it('translates the gateway answer for a stopped service in every language', () => {
    const stopped = new ApiError({
      kind: 'http',
      status: 503,
      code: 'gateway.unavailable',
      message: 'Service unavailable',
    })
    const english = createI18n({ language: 'en', resources: { en, tr } })
    const turkish = createI18n({ language: 'tr', resources: { en, tr } })
    expect(apiErrorMessage(stopped, english.t)).toBe(
      'The service is unavailable. Try again in a moment.',
    )
    expect(apiErrorMessage(stopped, turkish.t)).toBe(
      'Hizmet şu anda kullanılamıyor. Birazdan tekrar deneyin.',
    )
  })

  it('shows the reference of a failed load and retries', async () => {
    const onRetry = vi.fn()
    const screen = await renderWithI18n(
      <PageError
        title='Users could not be loaded'
        message='The server took too long to answer.'
        traceId='abc-123'
        onRetry={onRetry}
      />,
    )
    await expect.element(screen.getByRole('alert')).toMatchTextContent(/Users could not be loaded/)
    await expect.element(screen.getByText('abc-123')).toBeVisible()
    await screen.getByRole('button', { name: 'Try again' }).click()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('lets a user with no access to the app sign out', async () => {
    const onSignOut = vi.fn()
    const screen = await renderWithI18n(
      <NoPermission
        title='No access'
        message='Your account has no access to the web app.'
        onSignOut={onSignOut}
      />,
    )
    await expect.element(screen.getByText(/has no access to the web app/)).toBeVisible()
    await screen.getByRole('button', { name: 'Sign out' }).click()
    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('offers no sign out without a handler', async () => {
    const screen = await renderWithI18n(
      <NoPermission title='No access to Users' message='An administrator can add it.' />,
    )
    await expect.element(screen.getByText('No access to Users')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sign out' }).elements()).toHaveLength(0)
  })
})
