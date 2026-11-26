import type { APIRequestContext, Page, Request } from '@playwright/test'
import { compose } from './compose'
import { expect, signInToPanel, signInToWeb, test } from './fixtures'

// Stops user-service of this Compose project, runs the body, and starts it again whatever happens
async function whileUserServiceIsDown(request: APIRequestContext, body: () => Promise<void>) {
  compose('stop', 'user')
  try {
    await body()
  } finally {
    compose('start', 'user')
  }
  // Whatever the body proved, the next test finds user-service answering again
  await expect
    .poll(async () => (await request.get('/api/v1/users/me')).status(), { timeout: 90_000 })
    .toBe(401)
}

// Watches /users/me for a while: the session asks it again every 5 s while the page waits.
async function expectBootstrapEvery5s(page: Page) {
  const askedAt: number[] = []
  const onRequest = (request: Request) => {
    if (new URL(request.url()).pathname === '/api/v1/users/me') askedAt.push(Date.now())
  }
  page.on('request', onRequest)
  await page.waitForTimeout(17_000)
  page.off('request', onRequest)
  expect(askedAt.length).toBeGreaterThanOrEqual(3)
  const gaps = askedAt.slice(1).map((at, index) => at - (askedAt[index] ?? at))
  for (const gap of gaps) expect(gap).toBeLessThanOrEqual(6500)
  // A 30 s heartbeat may add one request in the window, never more
  expect(askedAt.length).toBeLessThanOrEqual(5)
}

function hhmm(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(at))
}

test.describe('an outage of user-service in the web app', () => {
  test.setTimeout(240_000)

  test('an outage of user-service does not sign the user out', async ({ page, request, seed }) => {
    const me = await request.get('/api/v1/users/me', {
      headers: { authorization: `Bearer ${seed.admin.token}` },
    })
    const { plantTimezone } = ((await me.json()) as { meta: { plantTimezone: string } }).meta
    await signInToWeb(page, seed.admin, '/users')
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible()

    let stoppedAt = 0
    await whileUserServiceIsDown(request, async () => {
      stoppedAt = Date.now()
      const offline = page.getByRole('status').filter({ hasText: 'Offline since' })
      await expect(offline).toBeVisible({ timeout: 60_000 })
      const seenAt = Date.now()
      await expect(page).not.toHaveURL(/\/login/)
      // The page stays, under the banner
      await expect(
        page.getByRole('status').filter({ hasText: 'Server unreachable, retrying' }),
      ).toBeVisible()
      await expect(page.getByRole('table', { name: 'Users' })).toBeVisible()
      // Since the moment the server went missing, in the plant's time
      const since = (await offline.innerText()).match(/(\d{2}:\d{2})/)?.[1]
      const candidates = new Set<string>()
      for (let t = stoppedAt - 60_000; t <= seenAt + 60_000; t += 30_000) {
        candidates.add(hhmm(t, plantTimezone))
      }
      expect([...candidates]).toContain(since)
    })

    await expect(page.getByRole('status').filter({ hasText: 'Offline since' })).toHaveCount(0, {
      timeout: 60_000,
    })
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('[data-slot="connection-indicator"]')).toHaveText('Live')
    await expect(page).toHaveURL(/\/users/)
  })

  test('a page loaded during the outage waits for the server and opens without a new sign-in', async ({
    page,
    request,
    seed,
  }) => {
    await signInToWeb(page, seed.admin, '/users')
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible()

    await whileUserServiceIsDown(request, async () => {
      await page.reload()
      await expect(page.getByText('Server unreachable, retrying')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0)
      await expect(page).not.toHaveURL(/\/login/)
    })

    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible({ timeout: 60_000 })
    await expect(page).toHaveURL(/\/users/)
  })

  // scenario: Web.shellOutage / edge cases / status unreachable without a user (the page was loaded
  // during an outage) → the same message full-screen, session.bootstrap() every 5 s, and the app
  // opens when it answers 200
  test('a page loaded during the outage shows the message full-screen and asks every 5 s', async ({
    page,
    request,
    seed,
  }) => {
    await signInToWeb(page, seed.admin, '/users')
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible()

    await whileUserServiceIsDown(request, async () => {
      await page.reload()
      const message = page.getByRole('status').filter({ hasText: 'Server unreachable, retrying' })
      await expect(message).toBeVisible({ timeout: 30_000 })
      // Full-screen: nothing of the layout is drawn around it
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0)
      await expect(page.getByRole('banner')).toHaveCount(0)
      await expect(page.getByRole('main')).toHaveCount(0)
      await expectBootstrapEvery5s(page)
      await expect(page).not.toHaveURL(/\/login/)
    })

    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible({ timeout: 60_000 })
    await expect(page).toHaveURL(/\/users/)
  })
})

test.describe('an outage of user-service in the operator panel', () => {
  test.setTimeout(240_000)
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true })

  test('the station keeps rendering under the banner and is not signed out', async ({
    page,
    request,
    seed,
  }) => {
    await signInToPanel(page, seed.operator)
    await expect(page.getByRole('heading', { name: seed.workCenter.name })).toBeVisible()

    await whileUserServiceIsDown(request, async () => {
      await expect(
        page.getByRole('status').filter({ hasText: 'Server unreachable, retrying' }),
      ).toBeVisible({ timeout: 60_000 })
      await expect(page.getByRole('heading', { name: seed.workCenter.name })).toBeVisible()
      await expect(page).not.toHaveURL(/\/operator\/login/)
    })

    await expect(page.getByText('Server unreachable, retrying')).toHaveCount(0, {
      timeout: 60_000,
    })
    await expect(page.getByRole('heading', { name: seed.workCenter.name })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible()
  })

  test('a tablet started during the outage says the server is unreachable, never no access', async ({
    page,
    request,
    seed,
  }) => {
    // Remembers whether the no-access screen was ever drawn, however briefly
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.body?.textContent?.includes('No access to the operator panel')) {
          sessionStorage.setItem('e2e.sawNoAccess', 'yes')
        }
      }).observe(document, { childList: true, subtree: true, characterData: true })
    })
    await signInToPanel(page, seed.operator)
    await expect(page.getByRole('heading', { name: seed.workCenter.name })).toBeVisible()

    await whileUserServiceIsDown(request, async () => {
      await page.reload()
      await expect(page.getByText('Server unreachable, retrying')).toBeVisible({ timeout: 30_000 })
      await expect(page).not.toHaveURL(/\/operator\/login/)
    })

    await expect(page.getByRole('heading', { name: seed.workCenter.name })).toBeVisible({
      timeout: 60_000,
    })
    expect(await page.evaluate(() => sessionStorage.getItem('e2e.sawNoAccess'))).toBeNull()
  })

  // scenario: Operator.shellOutage / edge cases / status unreachable without a user (the tablet
  // started during an outage) → the same message full-screen, session.bootstrap() every 5 s, and
  // the station opens when it answers 200
  test('a tablet started during the outage shows the message full-screen and asks every 5 s', async ({
    page,
    request,
    seed,
  }) => {
    await signInToPanel(page, seed.operator)
    await expect(page.getByRole('heading', { name: seed.workCenter.name })).toBeVisible()

    await whileUserServiceIsDown(request, async () => {
      await page.reload()
      const message = page.getByRole('status').filter({ hasText: 'Server unreachable, retrying' })
      await expect(message).toBeVisible({ timeout: 30_000 })
      // Full-screen: the station is not drawn under it
      await expect(page.getByRole('heading', { name: seed.workCenter.name })).toHaveCount(0)
      await expect(page.getByText('No running job order')).toHaveCount(0)
      await expectBootstrapEvery5s(page)
      await expect(page).not.toHaveURL(/\/operator\/login/)
    })

    await expect(page.getByRole('heading', { name: seed.workCenter.name })).toBeVisible({
      timeout: 60_000,
    })
    await expect(page).not.toHaveURL(/\/operator\/login/)
  })
})
