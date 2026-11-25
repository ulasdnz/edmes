import type { Page, WebSocketRoute } from '@playwright/test'
import { expect, signInAgainToWeb, signInToWeb, test } from './fixtures'
import { call } from './seed'

const usersTable = (page: Page) => page.getByRole('table', { name: 'Users' })
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' })
const connectionIndicator = (page: Page) => page.locator('[data-slot="connection-indicator"]')

function hhmm(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(at)
}

test.describe('signing in to the web app', () => {
  test('a wrong password stays on the login page with a message', async ({ page, seed }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await page.getByLabel('Email', { exact: true }).fill(seed.admin.email)
    await page.getByLabel('Password', { exact: true }).fill(`${seed.admin.password}-wrong`)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('alert')).not.toBeEmpty()
    await expect(page).toHaveURL(/\/login/)
    expect(await page.evaluate(() => localStorage.getItem('edmes.web.token'))).toBeNull()
  })

  test('the admin signs in, sees Users, and is still signed in after a reload', async ({
    page,
    seed,
  }) => {
    await signInToWeb(page, seed.admin)
    await expect(page).toHaveURL(/\/users/)
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible()
    await expect(usersTable(page)).toBeVisible()

    await page.reload()
    await expect(page).toHaveURL(/\/users/)
    await expect(usersTable(page)).toBeVisible()
  })

  test('a user without readUsers has no Users entry and sees the no-permission state at /users', async ({
    page,
    seed,
  }) => {
    await signInToWeb(page, seed.limited)
    await expect(navigation(page)).toBeVisible()
    await expect(navigation(page).getByRole('link', { name: 'Users' })).toHaveCount(0)

    await page.goto('/users')
    await expect(
      page.getByRole('heading', { name: 'You don’t have access to Users' }),
    ).toBeVisible()
    await expect(usersTable(page)).toHaveCount(0)
  })

  test('the ready-made Viewer sees Users and no button that changes anything', async ({
    page,
    seed,
  }) => {
    await signInToWeb(page, seed.viewer)
    await expect(navigation(page).getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(usersTable(page)).toBeVisible()

    // What the page offers: paging only
    const buttons = await page.getByRole('main').getByRole('button').all()
    for (const button of buttons) {
      const name = (await button.getAttribute('aria-label')) ?? (await button.innerText())
      expect(name).toMatch(/^(Previous page|Next page|Page \d+)$/)
    }
  })

  test('the ready-made Operator cannot enter the web app and can sign out', async ({
    page,
    seed,
  }) => {
    await signInToWeb(page, seed.operator)
    await expect(page.getByText('has no access to the web app')).toBeVisible()
    await expect(navigation(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  test('an expired session returns to the same view after signing in', async ({ page, seed }) => {
    await signInToWeb(page, seed.admin, '/users?page=2&size=50')
    await expect(page).toHaveURL(/\/users\?page=2&size=50/)
    await expect(usersTable(page)).toBeVisible()

    await page.evaluate(() => localStorage.setItem('edmes.web.token', 'garbage'))
    // Nobody touches the page: the heartbeat gets the 401
    await expect(page).toHaveURL(/\/login\?redirect=/, { timeout: 45_000 })

    await signInAgainToWeb(page, seed.admin)
    await expect(page).toHaveURL(/\/users\?page=2&size=50/)
    await expect(usersTable(page)).toBeVisible()
  })

  test('a stale token leads to the login page', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('edmes.web.token', 'garbage'))
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('the shell of the web app', () => {
  test('a collapsed sidebar is a 64 px rail and stays collapsed after a reload', async ({
    page,
    seed,
  }) => {
    await signInToWeb(page, seed.admin)
    await page.getByRole('button', { name: 'Collapse menu' }).click()
    await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible()
    expect((await navigation(page).boundingBox())?.width).toBe(64)

    await page.reload()
    await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible()
    expect((await navigation(page).boundingBox())?.width).toBe(64)
  })

  test('a viewport narrower than 1100 px starts with the rail', async ({ page, seed }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await signInToWeb(page, seed.admin)
    await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible()
    expect((await navigation(page).boundingBox())?.width).toBe(64)
  })

  test.describe('in a browser far from the plant', () => {
    test.use({ timezoneId: 'Pacific/Kiritimati' })

    test('the plant clock shows the server time in the plant time zone', async ({
      page,
      request,
      seed,
    }) => {
      const me = await request.get('/api/v1/users/me', {
        headers: { authorization: `Bearer ${seed.admin.token}` },
      })
      const { plantTimezone } = ((await me.json()) as { meta: { plantTimezone: string } }).meta
      await signInToWeb(page, seed.admin)

      const clock = page.getByText(/^Plant time/)
      await expect(clock).toContainText(plantTimezone)
      const shown = (await clock.innerText()).match(/(\d{2}:\d{2})/)?.[1]
      const now = Date.now()
      const plausible = [now - 60_000, now, now + 60_000].map(t => hhmm(new Date(t), plantTimezone))
      expect(plausible).toContain(shown)
      // The browser's own clock reads otherwise, so the plant's zone is really what is shown
      const browserTime = await page.evaluate(() =>
        new Intl.DateTimeFormat('en', {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date()),
      )
      expect(browserTime).not.toBe(shown)
    })
  })

  test('/users shows skeleton rows first and keeps its rows while the next page loads', async ({
    page,
    seed,
  }) => {
    let delayMs = 0
    await page.route(/\/api\/v1\/users\?/, async route => {
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
      await route.continue()
    })
    await signInToWeb(page, seed.admin, '/users')
    await expect(usersTable(page)).toBeVisible()

    delayMs = 2000
    await page.reload()
    await expect(page.getByText('Loading users…')).toBeAttached()
    await expect(usersTable(page)).toBeVisible()

    const firstRow = usersTable(page).locator('tbody tr').first()
    const firstRowOfPage1 = (await firstRow.textContent()) ?? ''
    await page.getByRole('button', { name: 'Page 2', exact: true }).click()
    // While page 2 loads, page 1 stays in place, marked busy
    await expect(page.locator('[aria-busy="true"]')).toBeVisible()
    await expect(firstRow).toHaveText(firstRowOfPage1)
    await expect(page.getByText('Loading users…')).toHaveCount(0)
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    await expect(firstRow).not.toHaveText(firstRowOfPage1)
  })

  test('/users keeps page, size, sort and search in the address only', async ({
    page,
    request,
    seed,
  }) => {
    await signInToWeb(page, seed.admin, '/users?sort=email')
    await page.getByRole('searchbox', { name: 'Search users' }).fill('e2e')
    await expect(page).toHaveURL(/search=e2e/)
    await page.getByLabel('Rows per page').selectOption('50')
    await expect(page).toHaveURL(/size=50/)
    await page.getByRole('button', { name: 'Page 2', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    const address = page.url()

    const expected = await call<Array<{ email: string }>>(
      request,
      'GET',
      '/api/v1/users?page=2&limit=50&sort=email&search=e2e',
      seed.admin.token,
    )
    await page.reload()
    expect(page.url()).toBe(address)
    await expect(page.getByRole('searchbox', { name: 'Search users' })).toHaveValue('e2e')
    await expect(page.getByLabel('Rows per page')).toHaveValue('50')
    await expect(page.getByRole('button', { name: 'Page 2', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(usersTable(page).locator('tbody tr').first()).toContainText(
      expected[0]?.email ?? 'no user',
    )

    // Nothing of it was kept anywhere else
    await page.goto('/users')
    await expect(page.getByRole('searchbox', { name: 'Search users' })).toHaveValue('')
    await expect(page.getByLabel('Rows per page')).toHaveValue('20')
    await expect(page.getByRole('button', { name: 'Page 1', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('Log out opens the login page with the current address to return to', async ({
    page,
    seed,
  }) => {
    await signInToWeb(page, seed.admin, '/users?size=50')
    await expect(usersTable(page)).toBeVisible()
    const shown = new URL(page.url())
    await page.getByRole('button', { name: 'User menu' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login\?redirect=/)
    expect(new URL(page.url()).searchParams.get('redirect')).toBe(shown.pathname + shown.search)
  })

  test('the indicator shows reconnecting while the realtime connection is down, then live', async ({
    page,
    seed,
  }) => {
    let blocked = false
    let current: WebSocketRoute | undefined
    await page.routeWebSocket(/\/socket\.io\//, ws => {
      if (blocked) {
        void ws.close()
        return
      }
      current = ws
      ws.connectToServer()
    })
    await signInToWeb(page, seed.admin)
    await expect(connectionIndicator(page)).toHaveText('Live')

    blocked = true
    await current?.close()
    await expect(connectionIndicator(page)).toHaveText('Reconnecting…')
    await expect(connectionIndicator(page)).toHaveAttribute('data-status', 'reconnecting')

    blocked = false
    await expect(connectionIndicator(page)).toHaveText('Live', { timeout: 15_000 })
  })

  test('a list that fails to load shows the error with its trace id', async ({ page, seed }) => {
    await signInToWeb(page, seed.admin)
    await expect(usersTable(page)).toBeVisible()
    // The next list request asks user-service for more rows than it serves, a real 400
    await page.route(
      /\/api\/v1\/users\?/,
      route =>
        route.continue({
          url: route
            .request()
            .url()
            .replace(/limit=\d+/, 'limit=1000'),
        }),
      { times: 1 },
    )
    const failed = page.waitForResponse(response => response.url().includes('limit=1000'))
    await page.goto('/users?size=50')
    const response = await failed
    expect(response.status()).toBe(400)
    const traceId = response.headers()['x-trace-id']
    expect(traceId).toBeTruthy()

    const error = page.getByRole('alert')
    await expect(error).toContainText('Users could not be loaded')
    await expect(error).toContainText(`Reference ${traceId}`)
    await expect(error.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('a new version on the server raises a toast with a reload action', async ({
    page,
    seed,
  }) => {
    await page.clock.install()
    await page.route('**/version.json', route => route.fulfill({ json: { version: 'next' } }))
    await signInToWeb(page, seed.admin)
    await expect(usersTable(page)).toBeVisible()

    await page.clock.fastForward('05:01')
    await expect(page.getByText('A new version of EDMES is available.')).toBeVisible()
    const reloaded = page.waitForEvent('load')
    await page.getByRole('button', { name: 'Reload' }).click()
    await reloaded
  })

  test('no request leaves the origin', async ({ page, seed, baseURL }) => {
    const origin = new URL(baseURL ?? 'http://localhost')
    const elsewhere: string[] = []
    page.on('request', request => {
      if (new URL(request.url()).host !== origin.host) elsewhere.push(request.url())
    })
    page.on('websocket', socket => {
      if (new URL(socket.url()).host !== origin.host) elsewhere.push(socket.url())
    })
    await signInToWeb(page, seed.admin)
    await expect(usersTable(page)).toBeVisible()
    await page.reload()
    await expect(usersTable(page)).toBeVisible()
    expect(elsewhere).toEqual([])
  })
})
