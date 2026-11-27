import { expect, signInToWeb, test } from './fixtures'
import { createUser, readyMadeRoleId } from './seed'

test.describe('the users list follows changes made elsewhere', () => {
  test('a user created elsewhere appears without a reload', async ({ page, request, seed }) => {
    await signInToWeb(page, seed.admin, '/users')
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible()
    await expect(page.locator('[data-slot="connection-indicator"]')).toHaveText('Live')
    const role = await readyMadeRoleId(request, seed.admin.token, 'viewer')

    const { email: newEmail } = await createUser(request, seed.admin.token, {
      label: 'realtime',
      roleIds: [role],
    })
    await expect(page.getByText(newEmail)).toBeVisible({ timeout: 5000 })
  })

  test('a burst of new users costs a few list requests, not one each', async ({
    page,
    request,
    seed,
  }) => {
    await signInToWeb(page, seed.admin, '/users')
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible()
    await expect(page.locator('[data-slot="connection-indicator"]')).toHaveText('Live')
    const role = await readyMadeRoleId(request, seed.admin.token, 'viewer')

    // The page's other /users requests are the subtitle's three counts, with limit=1
    const listRequests: string[] = []
    const countRequests: string[] = []
    page.on('request', r => {
      const url = new URL(r.url())
      if (url.pathname !== '/api/v1/users') return
      if (url.searchParams.get('limit') === '1') countRequests.push(r.url())
      else listRequests.push(r.url())
    })
    const startedAt = Date.now()
    let lastEmail = ''
    for (let n = 0; n < 10; n++) {
      ;({ email: lastEmail } = await createUser(request, seed.admin.token, {
        label: 'burst',
        roleIds: [role],
      }))
    }
    const burstMs = Date.now() - startedAt
    await expect(page.getByText(lastEmail)).toBeVisible({ timeout: 5000 })
    // The throttle allows one refetch at the first event and one per 2 s window after it
    expect(listRequests.length).toBeLessThanOrEqual(2 + Math.ceil(burstMs / 2000))
    // The counts follow the same throttle: each of the three at most as often as the list
    expect(countRequests.length).toBeLessThanOrEqual(3 * (2 + Math.ceil(burstMs / 2000)))
  })
})
