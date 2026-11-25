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
    await page.clock.fastForward('05:01')
    await page.clock.fastForward('00:20')
    expect(await page.evaluate(() => 'e2eBeforeReload' in window)).toBe(true)

    const reloaded = page.waitForEvent('load')
    await page.evaluate(() => document.getElementById('e2e-open-dialog')?.remove())
    await page.clock.fastForward('00:06')
    await reloaded
    expect(await page.evaluate(() => 'e2eBeforeReload' in window)).toBe(false)
  })
})
