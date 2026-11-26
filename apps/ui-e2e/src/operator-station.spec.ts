import { expect, signInAgainToPanel, signInToPanel, test } from './fixtures'
import { createUser, createWorkCenter, readyMadeRoleId, startJobOrder } from './seed'

const storedStation = () => localStorage.getItem('edmes.operator.station')

test.describe('the station screen', () => {
  test('the operator lands on the only visible station and sees a job order start live', async ({
    page,
    request,
    seed,
  }) => {
    await signInToPanel(page, seed.operator)
    await expect(page.getByText(seed.workCenter.name)).toBeVisible()
    await expect(page.getByText('No running job order')).toBeVisible()
    expect(await page.evaluate(storedStation)).toBe(seed.workCenter._id)
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible()

    const { code } = await startJobOrder(request, seed)
    await expect(page.getByText(code)).toBeVisible({ timeout: 5000 })
  })

  test('when the token runs out the operator signs in again and is back at the station', async ({
    page,
    seed,
  }) => {
    await signInToPanel(page, seed.operator)
    await expect(page.getByText(seed.workCenter.name)).toBeVisible()

    await page.evaluate(() => localStorage.setItem('edmes.operator.token', 'garbage'))
    // The heartbeat notices, nobody touched the screen
    await expect(page).toHaveURL(/\/operator\/login/, { timeout: 45_000 })

    await signInAgainToPanel(page, seed.operator)
    await expect(page.getByText(seed.workCenter.name)).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible()
  })

  test('the panel is built for touch', async ({ page, request }) => {
    const html = await (await request.get('/operator/')).text()
    expect(html).toContain('data-density="touch"')
    await page.goto('/operator/')
    await expect(page.locator('html')).toHaveAttribute('data-density', 'touch')
  })
})

test.describe('an operator with several work centers', () => {
  test('chooses the station from the picker, and the choice is kept on the tablet', async ({
    page,
    request,
    seed,
  }) => {
    const second = await createWorkCenter(request, seed.admin.token)
    const operator = await createUser(request, seed.admin.token, {
      label: 'twostations',
      roleIds: [await readyMadeRoleId(request, seed.admin.token, 'operator')],
      workCenterIds: [seed.workCenter._id, second.workCenter._id],
    })

    await signInToPanel(page, operator)
    await expect(page.getByRole('heading', { name: 'Choose the work center' })).toBeVisible()
    await expect(page.getByRole('button', { name: seed.workCenter.name })).toBeVisible()
    await page.getByRole('button', { name: second.workCenter.name }).click()

    await expect(page.getByRole('heading', { name: second.workCenter.name })).toBeVisible()
    expect(await page.evaluate(storedStation)).toBe(second.workCenter._id)
  })

  test('a station whose room the gateway refuses is forgotten and the picker opens', async ({
    page,
    request,
    seed,
  }) => {
    const second = await createWorkCenter(request, seed.admin.token)
    const notTheirs = await createWorkCenter(request, seed.admin.token)
    const operator = await createUser(request, seed.admin.token, {
      label: 'refused',
      roleIds: [await readyMadeRoleId(request, seed.admin.token, 'operator')],
      workCenterIds: [seed.workCenter._id, second.workCenter._id],
    })
    await signInToPanel(page, operator)
    await expect(page.getByRole('heading', { name: 'Choose the work center' })).toBeVisible()

    const joins: string[] = []
    page.on('websocket', socket => {
      socket.on('framesent', frame => {
        if (typeof frame.payload === 'string' && frame.payload.includes('"join"')) {
          joins.push(frame.payload)
        }
      })
    })
    await page.evaluate(
      id => localStorage.setItem('edmes.operator.station', id),
      notTheirs.workCenter._id,
    )
    await page.goto('/operator/')

    await expect(page.getByRole('heading', { name: 'Choose the work center' })).toBeVisible()
    expect(await page.evaluate(storedStation)).toBeNull()
    expect(joins.some(join => join.includes(`wc:${notTheirs.workCenter._id}`))).toBe(true)
  })
})

test.describe('a new version on the server', () => {
  test('reloads the panel only once no dialog is open', async ({ page, seed }) => {
    await page.clock.install()
    await page.route('**/version.json', route => route.fulfill({ json: { version: 'next' } }))
    await signInToPanel(page, seed.operator)
    await expect(page.getByText(seed.workCenter.name)).toBeVisible()

    await page.evaluate(() => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.id = 'e2e-open-dialog'
      document.body.append(dialog)
      Object.assign(window, { e2eBeforeReload: true })
    })
    // The check fires on the fake clock, but its answer arrives in real time: wait for it, then
    // step the clock, so the idle poll is running before the dialog closes.
    const versionAnswered = page.waitForResponse(response =>
      response.url().endsWith('/version.json'),
    )
    await page.clock.fastForward('05:01')
    await versionAnswered
    for (let step = 0; step < 4; step++) await page.clock.fastForward('00:06')
    expect(await page.evaluate(() => 'e2eBeforeReload' in window)).toBe(true)

    let reloaded = false
    page.once('load', () => {
      reloaded = true
    })
    await page.evaluate(() => document.getElementById('e2e-open-dialog')?.remove())
    await expect(async () => {
      if (!reloaded) await page.clock.fastForward('00:06')
      expect(reloaded).toBe(true)
    }).toPass({ timeout: 30_000 })
    expect(await page.evaluate(() => 'e2eBeforeReload' in window)).toBe(false)
  })

  // scenario: Operator.shell / edge cases / /version.json reports another version → the panel
  // reloads only when queryClient.isMutating() is 0 and no [role="dialog"] is in the document
  test('reloads the panel only once no mutation runs and no dialog is open', async ({
    page,
    seed,
  }) => {
    await page.clock.install()
    await page.route('**/version.json', route => route.fulfill({ json: { version: 'next' } }))
    await signInToPanel(page, seed.operator)
    await expect(page.getByText(seed.workCenter.name)).toBeVisible()

    // The panel has no screen that writes yet, so the test starts a mutation on the panel's own
    // QueryClient, found through React's root fiber, and finishes it when it wants.
    await page.evaluate(() => {
      const root = document.getElementById('root') as unknown as Record<string, unknown> | null
      const containerKey = Object.keys(root ?? {}).find(key => key.startsWith('__reactContainer$'))
      type Fiber = { memoizedProps?: { client?: unknown }; child?: Fiber; sibling?: Fiber }
      const pending: Fiber[] = containerKey ? [root?.[containerKey] as Fiber] : []
      let client: unknown
      while (pending.length > 0 && !client) {
        const fiber = pending.pop()
        const candidate = fiber?.memoizedProps?.client as { isMutating?: unknown } | undefined
        if (typeof candidate?.isMutating === 'function') client = candidate
        if (fiber?.child) pending.push(fiber.child)
        if (fiber?.sibling) pending.push(fiber.sibling)
      }
      if (!client) throw new Error('the QueryClient of the panel was not found')
      const queryClient = client as {
        getMutationCache(): {
          build(
            client: unknown,
            options: { mutationFn: () => Promise<void> },
          ): { execute(variables: undefined): Promise<unknown> }
        }
      }
      const finish = new Promise<void>(resolve => {
        Object.assign(window, { e2eFinishMutation: resolve })
      })
      void queryClient
        .getMutationCache()
        .build(queryClient, { mutationFn: () => finish })
        .execute(undefined)

      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.id = 'e2e-open-dialog'
      document.body.append(dialog)
      Object.assign(window, { e2eBeforeReload: true })
    })
    const versionAnswered = page.waitForResponse(response =>
      response.url().endsWith('/version.json'),
    )
    await page.clock.fastForward('05:01')
    await versionAnswered
    for (let step = 0; step < 4; step++) await page.clock.fastForward('00:06')
    expect(await page.evaluate(() => 'e2eBeforeReload' in window)).toBe(true)

    // The dialog closes, the mutation still runs: no reload
    await page.evaluate(() => document.getElementById('e2e-open-dialog')?.remove())
    for (let step = 0; step < 4; step++) await page.clock.fastForward('00:06')
    expect(await page.evaluate(() => 'e2eBeforeReload' in window)).toBe(true)

    let reloaded = false
    page.once('load', () => {
      reloaded = true
    })
    await page.evaluate(() =>
      (window as unknown as { e2eFinishMutation: () => void }).e2eFinishMutation(),
    )
    await expect(async () => {
      if (!reloaded) await page.clock.fastForward('00:06')
      expect(reloaded).toBe(true)
    }).toPass({ timeout: 30_000 })
    expect(await page.evaluate(() => 'e2eBeforeReload' in window)).toBe(false)
  })
})
