import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ApiAnswer, serveApi, unavailable } from '../../test/fake-api'
import { renderInApp } from '../../test/render'
import { LoginPage } from './login-page'

const SERVER_TIME = '2026-11-23T07:42:00.000Z'
const plantTime: ApiAnswer = {
  body: { data: { plantTimezone: 'Europe/Istanbul', serverTime: SERVER_TIME } },
}

const noSubmit = () => Promise.resolve()

function imagesOf(container: Element) {
  return [...container.querySelectorAll('img')]
}

describe('LoginPage', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // scenario: Web.signInBrand / happy path / the brand panel: mark, wordmark, tagline, network line
  it('shows the brand panel beside the form', async () => {
    serveApi(() => plantTime)
    const screen = await renderInApp(<LoginPage onSubmit={noSubmit} />)

    await expect
      .element(
        screen.getByText(
          'Plan and follow production, keep stops explained and read OEE for the work centers assigned to you.',
        ),
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('Runs on this factory network · no internet connection needed'))
      .toBeVisible()
    const wordmark = screen.getByRole('img', { name: 'EDMES' })
    await expect.element(wordmark).toBeVisible()
    const images = imagesOf(screen.container)
    expect(images).toHaveLength(2)
    const mark = images.find(image => image.getAttribute('alt') === '')
    expect(mark).toBeDefined()
    await expect
      .poll(() => images.every(image => image.complete && image.naturalWidth > 0))
      .toBe(true)
    expect(mark?.naturalWidth).toBe(mark?.naturalHeight)
    await expect.element(screen.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  // scenario: Web.signInBrand / happy path / plant time from GET /auth/plant-time, in English
  it('shows the plant time the server answers', async () => {
    const asked = serveApi(() => plantTime)
    const screen = await renderInApp(<LoginPage onSubmit={noSubmit} />)

    await expect.element(screen.getByText('Plant time 10:42 · Europe/Istanbul')).toBeVisible()
    expect(asked.map(request => `${request.method} ${request.path}`)).toEqual([
      'GET /auth/plant-time',
    ])
    expect(asked[0]?.headers.get('authorization')).toBeNull()
  })

  // scenario: Web.signInBrand / happy path / plant time in Turkish
  it('shows the plant time in Turkish', async () => {
    serveApi(() => plantTime)
    const screen = await renderInApp(<LoginPage onSubmit={noSubmit} />, { language: 'tr' })

    await expect.element(screen.getByText('Tesis saati 10:42 · Europe/Istanbul')).toBeVisible()
  })

  // scenario: Web.signInBrand / edge cases / the device clock is 2 hours behind the server
  it('shows the server time when the device clock is two hours behind', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.parse(SERVER_TIME) - 2 * 3_600_000))
    serveApi(() => plantTime)
    const screen = await renderInApp(<LoginPage onSubmit={noSubmit} />)

    await expect.element(screen.getByText('Plant time 10:42 · Europe/Istanbul')).toBeVisible()
  })

  // scenario: Web.signInBrand / edge cases / GET /auth/plant-time fails (network or 503)
  it.each([
    ['the network fails', 'network-error' as const],
    ['the service is unavailable', unavailable],
  ])('leaves the plant time out when %s, and the form still signs in', async (_name, answer) => {
    const asked = serveApi(() => answer)
    const onSubmit = vi.fn(noSubmit)
    const screen = await renderInApp(<LoginPage onSubmit={onSubmit} />)

    await vi.waitFor(() => expect(asked).toHaveLength(1))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(screen.getByText(/Plant time/).elements()).toHaveLength(0)
    await expect
      .element(screen.getByText('Runs on this factory network · no internet connection needed'))
      .toBeVisible()
    await screen.getByLabelText('Email').fill('ada@example.com')
    await screen.getByLabelText('Password', { exact: true }).fill('secret')
    await screen.getByRole('button', { name: 'Sign in' }).click()
    expect(onSubmit).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'secret' })
  })

  // scenario: Web.signInBrand / edge cases / the minute advances while the page is open
  it('follows the minute without a reload', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(SERVER_TIME))
    const asked = serveApi(() => plantTime)
    const screen = await renderInApp(<LoginPage onSubmit={noSubmit} />)
    await expect.element(screen.getByText('Plant time 10:42 · Europe/Istanbul')).toBeVisible()

    vi.setSystemTime(new Date(Date.parse(SERVER_TIME) + 60_000))

    await expect.element(screen.getByText('Plant time 10:43 · Europe/Istanbul')).toBeVisible()
    expect(asked).toHaveLength(1)
  })
})
