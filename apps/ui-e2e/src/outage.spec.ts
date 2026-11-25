import type { APIRequestContext } from '@playwright/test'
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
})
