import { ApiError } from '@mes/api-client'
import { createI18n } from '@mes/frontend/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('names the missing permission of a page in every language', () => {
    const english = createI18n({ language: 'en', resources: { en, tr } })
    const turkish = createI18n({ language: 'tr', resources: { en, tr } })
    expect(english.t('access.noPage', { permission: english.t('privileges.readUsers') })).toBe(
      'This page needs the Read Users permission. An administrator can add it to one of your roles.',
    )
    expect(turkish.t('access.noPage', { permission: turkish.t('privileges.readUsers') })).toBe(
      'Bu sayfa için Kullanıcıları görüntüle izni gerekiyor. Bir yönetici bu izni rollerinizden birine ekleyebilir.',
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

  describe('copy error details', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    const details = {
      code: 'client.timeout',
      status: 504,
      occurredAt: '2026-11-23T07:42:00.000Z',
      timeZone: 'Europe/Istanbul',
    }

    function renderError(traceId?: string) {
      return renderWithI18n(
        <PageError
          title='Users could not be loaded'
          message='The server took too long to answer.'
          traceId={traceId}
          details={details}
          onRetry={() => {}}
        />,
      )
    }

    // scenario: Web.copyErrorDetails / happy path / copies code, status, trace id and plant time
    it('copies the code, the HTTP status, the trace id and the plant time, then says Copied', async () => {
      const copied: string[] = []
      vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async text => {
        copied.push(text)
      })
      const screen = await renderError('abc-123')
      const tryAgain = screen.getByRole('button', { name: 'Try again' })
      const copy = screen.getByRole('button', { name: 'Copy error details' })
      await expect.element(tryAgain).toBeVisible()
      await expect.element(copy).toBeVisible()
      // next to Try again: the same row
      expect(copy.element().parentElement).toBe(tryAgain.element().parentElement)

      await copy.click()

      await expect.element(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
      expect(copied).toHaveLength(1)
      const text = copied[0] ?? ''
      expect(text).toContain('code: client.timeout')
      expect(text).toContain('HTTP status: 504')
      expect(text).toContain('trace id: abc-123')
      expect(text).toMatch(/time: .*10:42.* Europe\/Istanbul/)
      await expect
        .element(screen.getByRole('button', { name: 'Copy error details' }), { timeout: 4000 })
        .toBeVisible()
    })

    // scenario: Web.copyErrorDetails / edge cases / clipboard and fallback refuse → Copy failed
    it('keeps the details selectable on screen and says Copy failed when nothing can copy', async () => {
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
        new DOMException('Write permission denied.', 'NotAllowedError'),
      )
      vi.spyOn(document, 'execCommand').mockReturnValue(false)
      const screen = await renderError('abc-123')

      await screen.getByRole('button', { name: 'Copy error details' }).click()

      await expect.element(screen.getByRole('button', { name: 'Copy failed' })).toBeVisible()
      const shown = screen.getByText(/code: client\.timeout/)
      await expect.element(shown).toBeVisible()
      await expect.element(shown).toMatchTextContent(/HTTP status: 504/)
      await expect.element(shown).toMatchTextContent(/trace id: abc-123/)
      expect(getComputedStyle(shown.element()).userSelect).not.toBe('none')
      const selection = getSelection()
      selection?.selectAllChildren(shown.element())
      expect(selection?.toString()).toContain('code: client.timeout')
    })

    // scenario: Web.copyErrorDetails / edge cases / no secure context (plain HTTP) → copied anyway
    it('copies through a hidden text area where the browser has no clipboard, as on plain HTTP', async () => {
      vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as unknown as Clipboard)
      const copied: string[] = []
      vi.spyOn(document, 'execCommand').mockImplementation(command => {
        const field = document.activeElement
        if (command === 'copy' && field instanceof HTMLTextAreaElement) {
          copied.push(field.value.slice(field.selectionStart, field.selectionEnd))
          return true
        }
        return false
      })
      const screen = await renderError('abc-123')

      await screen.getByRole('button', { name: 'Copy error details' }).click()

      await expect.element(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
      expect(copied).toHaveLength(1)
      expect(copied[0]).toContain('code: client.timeout')
      expect(copied[0]).toContain('trace id: abc-123')
      // the text area is gone again
      expect(document.querySelectorAll('textarea')).toHaveLength(0)
    })

    // scenario: Web.copyErrorDetails / edge cases / clipboard missing and fallback refuses
    it('says Copy failed and shows the details where neither the clipboard nor the fallback copies', async () => {
      vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as unknown as Clipboard)
      vi.spyOn(document, 'execCommand').mockReturnValue(false)
      const screen = await renderError('abc-123')

      await screen.getByRole('button', { name: 'Copy error details' }).click()

      await expect.element(screen.getByRole('button', { name: 'Copy failed' })).toBeVisible()
      await expect.element(screen.getByText(/code: client\.timeout/)).toBeVisible()
    })

    // scenario: Web.copyErrorDetails / edge cases / no trace id → "trace id: none"
    it('says trace id: none for an error without a trace id', async () => {
      const copied: string[] = []
      vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async text => {
        copied.push(text)
      })
      const screen = await renderError()

      await screen.getByRole('button', { name: 'Copy error details' }).click()

      await expect.element(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
      expect(copied[0]).toContain('trace id: none')
    })

    it('says the buttons in Turkish', async () => {
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
      vi.spyOn(document, 'execCommand').mockReturnValue(false)
      const screen = await renderWithI18n(
        <PageError title='t' message='m' details={details} onRetry={() => {}} />,
        'tr',
      )
      await screen.getByRole('button', { name: 'Hata ayrıntılarını kopyala' }).click()
      await expect.element(screen.getByRole('button', { name: 'Kopyalanamadı' })).toBeVisible()
    })
  })
})
