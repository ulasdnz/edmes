import { fileURLToPath } from 'node:url'
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, signInToWeb, test } from './fixtures'
import { type Credentials, call, createUser, login, readyMadeRoleId } from './seed'

const avatarFixture = fileURLToPath(new URL('../fixtures/avatar.png', import.meta.url))

const personalDetails = (page: Page, name = 'Personal details') =>
  page.getByRole('region', { name })

// A Viewer of its own for each test, never the system admin: the tests change the profile
async function profileUser(
  request: APIRequestContext,
  adminToken: string,
  label: string,
): Promise<Credentials> {
  const role = await readyMadeRoleId(request, adminToken, 'viewer')
  const { email, password } = await createUser(request, adminToken, { label, roleIds: [role] })
  return { email, password }
}

test.describe('the Profile page', () => {
  test('a new surname and Turkish are saved, shown at once and kept after a reload', async ({
    page,
    request,
    seed,
  }) => {
    const user = await profileUser(request, seed.admin.token, 'profile')
    await signInToWeb(page, user)

    await page.getByRole('button', { name: 'User menu' }).click()
    await page.getByRole('menuitem', { name: 'Profile and language' }).click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()

    const details = personalDetails(page)
    await details.getByLabel('Surname').fill('Yılmaz')
    await details.getByLabel('Language').selectOption('tr')
    await details.getByRole('button', { name: 'Save profile' }).click()

    const turkishMenu = page.getByRole('button', { name: 'Kullanıcı menüsü' })
    await expect(page.getByRole('heading', { name: 'Profil', level: 1 })).toBeVisible()
    await expect(turkishMenu).toContainText('E2E Yılmaz')
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr')

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Profil', level: 1 })).toBeVisible()
    await expect(turkishMenu).toContainText('E2E Yılmaz')
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr')
    const reloaded = personalDetails(page, 'Kişisel bilgiler')
    await expect(reloaded.getByLabel('Soyad')).toHaveValue('Yılmaz')
    await expect(reloaded.getByLabel('Dil')).toHaveValue('tr')
  })

  test('an uploaded PNG shows as the avatar, and removing it brings the initials back', async ({
    page,
    request,
    seed,
  }) => {
    // createUser names the user "E2E <label>"
    const user = await profileUser(request, seed.admin.token, 'avatar')
    await signInToWeb(page, user, '/profile')
    await expect(page).toHaveURL(/\/profile$/)

    const details = personalDetails(page)
    const photo = details.getByRole('img', { name: 'Your photo' })
    const initials = details.getByText('EA', { exact: true })
    await expect(initials).toBeVisible()
    await expect(photo).toHaveCount(0)

    const chooser = page.waitForEvent('filechooser')
    await details.getByRole('button', { name: 'Upload photo' }).click()
    await (await chooser).setFiles(avatarFixture)

    await expect(photo).toBeVisible()
    await expect(photo).toHaveAttribute('src', /^\/uploads\//)
    // The file is served back, not only referenced
    await expect.poll(() => photo.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(16)
    await expect(initials).toHaveCount(0)

    await details.getByRole('button', { name: 'Remove' }).click()
    await expect(photo).toHaveCount(0)
    await expect(initials).toBeVisible()
    await expect(details.getByRole('button', { name: 'Remove' })).toBeDisabled()
  })

  // scenario: E2E.profile / authorization / [CRITICAL]
  test('the username cannot be changed from Profile, and the API refuses one sent by the user', async ({
    page,
    request,
    seed,
  }) => {
    const user = await profileUser(request, seed.admin.token, 'username')
    const { token } = await login(request, user)
    const { username } = await call<{ username: string }>(request, 'GET', '/api/v1/users/me', token)

    await signInToWeb(page, user, '/profile')
    const field = personalDetails(page).getByLabel('Username')
    await expect(field).toHaveValue(username)
    await expect(field).not.toBeEditable()

    const response = await request.patch('/api/v1/users/me', {
      headers: { authorization: `Bearer ${token}` },
      data: { username: 'renamed.by.self' },
    })
    expect(response.status()).toBe(400)
    const body = (await response.json()) as {
      error: { code: string; details?: Array<{ field: string }> }
    }
    expect(body.error.code).toBe('error.validation_failed')
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'username' })]),
    )

    const after = await call<{ username: string }>(request, 'GET', '/api/v1/users/me', token)
    expect(after.username).toBe(username)
  })
})
