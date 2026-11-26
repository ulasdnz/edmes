import { test as base, expect, type Page } from '@playwright/test'
import { type Credentials, type Seed, seed } from './seed'

// One seed per worker; the suite runs on one worker, so each project seeds once.
export const test = base.extend<object, { seed: Seed }>({
  seed: [
    async ({ playwright }, use, workerInfo) => {
      const request = await playwright.request.newContext({
        baseURL: workerInfo.project.use.baseURL,
      })
      await use(await seed(request))
      await request.dispose()
    },
    { scope: 'worker' },
  ],
})

export { expect }

async function fillLogin(page: Page, user: Credentials) {
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

// Opens a page of the web app as an anonymous visitor and signs in on the login page it leads to.
export async function signInToWeb(page: Page, user: Credentials, path = '/') {
  await page.goto(path)
  await expect(page).toHaveURL(/\/login/)
  await fillLogin(page, user)
  await expect(page).not.toHaveURL(/\/login/)
}

// Signs in on the login page the web app is showing.
export async function signInAgainToWeb(page: Page, user: Credentials) {
  await expect(page).toHaveURL(/\/login/)
  await fillLogin(page, user)
  await expect(page).not.toHaveURL(/\/login/)
}

export async function signInToPanel(page: Page, user: Credentials) {
  await page.goto('/operator/')
  await signInAgainToPanel(page, user)
}

export async function signInAgainToPanel(page: Page, user: Credentials) {
  await expect(page).toHaveURL(/\/operator\/login/)
  await fillLogin(page, user)
  await expect(page).not.toHaveURL(/\/operator\/login/)
}
