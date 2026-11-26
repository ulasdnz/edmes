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

  // scenario: E2E.webAuth / authorization / seed.limited: no Users entry, the no-permission state
  // at /users names the missing permission
  test('the no-permission state at /users names the missing permission', async ({ page, seed }) => {
    await signInToWeb(page, seed.limited)
    await expect(navigation(page)).toBeVisible()
    await expect(navigation(page).getByRole('link', { name: 'Users' })).toHaveCount(0)

    await page.goto('/users')
    const state = page.getByRole('main')
    await expect(state.getByRole('heading', { level: 2 })).toBeVisible()
    await expect(usersTable(page)).toHaveCount(0)
    // readUsers is the permission /users needs; its text in @mes/privileges is "Read Users"
    await expect(state).toContainText('This page needs the Read Users permission.')
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

  // scenario: Web.shell / happy path / the sidebar is collapsed → a 64 px rail; the choice is
  // written with writePrefs and is still there after a reload
  test('the collapsed sidebar is written with writePrefs under the user and kept after a reload', async ({
    page,
    request,
    seed,
  }) => {
    const me = await request.get('/api/v1/users/me', {
      headers: { authorization: `Bearer ${seed.admin.token}` },
    })
    const adminId = ((await me.json()) as { data: { _id: string } }).data._id
    await signInToWeb(page, seed.admin)
    await page.getByRole('button', { name: 'Collapse menu' }).click()
    await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible()
    expect((await navigation(page).boundingBox())?.width).toBe(64)
    const stored = await page.evaluate(
      key => localStorage.getItem(key),
      `edmes.web.prefs.${adminId}`,
    )
    expect(JSON.parse(stored ?? 'null')).toEqual({ sidebar: 'rail' })

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

  // scenario: Web.shell / constraints / realtime connecting or reconnecting → reconnecting; session
  // unreachable or realtime unavailable → offline with Offline since HH:mm from the time that
  // state began, in server time (a device clock that is off does not shift it); otherwise live
  test.describe('on a device whose clock is two hours behind', () => {
    test('the indicator says reconnecting, offline since the moment in server time, and live', async ({
      page,
      request,
      seed,
    }) => {
      test.setTimeout(180_000)
      const me = await request.get('/api/v1/users/me', {
        headers: { authorization: `Bearer ${seed.admin.token}` },
      })
      const { plantTimezone } = ((await me.json()) as { meta: { plantTimezone: string } }).meta
      const deviceOffsetMs = -2 * 3_600_000
      await page.clock.install({ time: Date.now() + deviceOffsetMs })

      let closeNewSockets = false
      // The gateway's answer when it cannot check a token: CONNECT_ERROR auth.unavailable
      let refuseConnect = false
      let current: WebSocketRoute | undefined
      await page.routeWebSocket(/\/socket\.io\//, ws => {
        if (closeNewSockets) {
          void ws.close()
          return
        }
        current = ws
        const server = ws.connectToServer()
        ws.onMessage(message => {
          if (refuseConnect && typeof message === 'string' && message.startsWith('40')) {
            ws.send('44{"message":"auth.unavailable"}')
            return
          }
          server.send(message)
        })
      })

      // The shown time must be the plant's real time around the outage, never the device's
      const expectOfflineSince = async (startedAt: number) => {
        await expect(connectionIndicator(page)).toHaveAttribute('data-status', 'offline', {
          timeout: 45_000,
        })
        const text = await connectionIndicator(page).innerText()
        expect(text).toMatch(/^Offline since \d{2}:\d{2}$/)
        const shown = text.match(/(\d{2}:\d{2})/)?.[1]
        const candidates = new Set<string>()
        for (let t = startedAt - 60_000; t <= Date.now() + 60_000; t += 30_000) {
          candidates.add(hhmm(new Date(t), plantTimezone))
        }
        expect([...candidates]).toContain(shown)
        expect(shown).not.toBe(hhmm(new Date(Date.now() + deviceOffsetMs), plantTimezone))
      }

      await signInToWeb(page, seed.admin)
      await expect(usersTable(page)).toBeVisible()
      await expect(connectionIndicator(page)).toHaveText('Live')
      await expect(connectionIndicator(page)).toHaveAttribute('data-status', 'live')

      // realtime reconnecting
      closeNewSockets = true
      await current?.close()
      await expect(connectionIndicator(page)).toHaveText('Reconnecting…')
      await expect(connectionIndicator(page)).toHaveAttribute('data-status', 'reconnecting')
      closeNewSockets = false
      await expect(connectionIndicator(page)).toHaveText('Live', { timeout: 15_000 })

      // realtime unavailable
      refuseConnect = true
      const refusedAt = Date.now()
      await current?.close()
      await expectOfflineSince(refusedAt)
      refuseConnect = false
      await expect(connectionIndicator(page)).toHaveText('Live', { timeout: 15_000 })

      // session unreachable: user-service's paths answer what the gateway answers for a stopped one
      const unreachableAt = Date.now()
      await page.route('**/api/v1/users/me', route =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'cache-control': 'no-store' },
          body: '{"error":{"code":"gateway.unavailable","message":"Service unavailable"}}',
        }),
      )
      await expectOfflineSince(unreachableAt)
      await page.unroute('**/api/v1/users/me')
      await expect(connectionIndicator(page)).toHaveText('Live', { timeout: 45_000 })
      await expect(connectionIndicator(page)).toHaveAttribute('data-status', 'live')
    })
  })

  // scenario: Web.shell / constraints / the session status is unknown (bootstrap pending) → the
  // app renders at once with a loading state, never a blank page
  test('while the session is still unknown the app shows a loading state', async ({
    page,
    seed,
  }) => {
    await signInToWeb(page, seed.admin)
    await expect(usersTable(page)).toBeVisible()

    let released = false
    await page.route('**/api/v1/users/me', async route => {
      await new Promise(resolve => setTimeout(resolve, 3000))
      released = true
      await route.continue()
    })
    await page.reload()
    await expect(page.getByText('Loading…', { exact: true })).toBeVisible()
    expect(released).toBe(false)
    await expect(usersTable(page)).toBeVisible()
  })

  test('a list that fails to load shows the error with its trace id', async ({ page, seed }) => {
    await signInToWeb(page, seed.admin)
    await expect(usersTable(page)).toBeVisible()
    // The next list request asks user-service for more rows than it serves, a real 400. The
    // subtitle's counts (limit=1) are not the list and pass untouched.
    await page.route(
      url => url.pathname === '/api/v1/users' && url.searchParams.get('limit') !== '1',
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

test.describe('the canvas pass of the web shell', () => {
  // scenario: E2E.webShellCanvas / happy path / sign-in page shows the plant time of the server
  test('the sign-in page shows the plant time in the stack’s plant time zone', async ({
    page,
    request,
    seed,
  }) => {
    const me = await request.get('/api/v1/users/me', {
      headers: { authorization: `Bearer ${seed.admin.token}` },
    })
    const { plantTimezone } = ((await me.json()) as { meta: { plantTimezone: string } }).meta
    await page.goto('/login')

    const line = page.getByText(/^Plant time \d{2}:\d{2} · /)
    await expect(line).toHaveText(new RegExp(`^Plant time \\d{2}:\\d{2} · ${plantTimezone}$`))
    const shown = (await line.innerText()).match(/(\d{2}:\d{2})/)?.[1]
    const now = Date.now()
    const plausible = [now - 60_000, now, now + 60_000].map(t => hhmm(new Date(t), plantTimezone))
    expect(plausible).toContain(shown)
  })

  // scenario: E2E.webShellCanvas / constraints / [HIGH] before sign-in only GET
  // /api/v1/auth/plant-time, without a token
  test('the sign-in page asks only for the plant time, without a token, before sign-in', async ({
    page,
  }) => {
    const asked: { method: string; path: string; authorization: string | undefined }[] = []
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) {
        asked.push({
          method: request.method(),
          path: url.pathname,
          authorization: request.headers().authorization,
        })
      }
    })
    await page.goto('/login')
    await expect(page.getByText(/^Plant time \d{2}:\d{2} · /)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()

    expect(asked).toEqual([
      { method: 'GET', path: '/api/v1/auth/plant-time', authorization: undefined },
    ])
  })

  // scenario: E2E.webShellCanvas / happy path / users page subtitle equals the API's three counts
  test('the users page subtitle equals the counts the API answers', async ({
    page,
    request,
    seed,
  }) => {
    const total = async (query: string) => {
      const response = await request.get(`/api/v1/users?${query}`, {
        headers: { authorization: `Bearer ${seed.admin.token}` },
      })
      expect(response.ok()).toBe(true)
      return ((await response.json()) as { pagination: { total: number } }).pagination.total
    }
    const all = await total('limit=1')
    const active = await total('limit=1&isActivated=true')
    const withoutWorkCenter = await total('limit=1&withoutWorkCenter=true')
    const expected = [
      `${all} ${all === 1 ? 'user' : 'users'}`,
      `${active} active`,
      ...(withoutWorkCenter > 0 ? [`${withoutWorkCenter} without any work center`] : []),
    ].join(' · ')

    await signInToWeb(page, seed.admin, '/users')
    await expect(usersTable(page)).toBeVisible()
    await expect(page.getByText(expected, { exact: true })).toBeVisible()
  })
})
