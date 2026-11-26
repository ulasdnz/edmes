import { expect, signInToPanel, signInToWeb, test } from './fixtures'

test.describe('who may use the operator panel', () => {
  test('an operator with no work center is told so and can sign out', async ({ page, seed }) => {
    await signInToPanel(page, seed.unassignedOperator)
    await expect(
      page.getByRole('heading', { name: 'No work center is assigned to you' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/operator\/login/)
  })

  test('the ready-made Viewer cannot enter the panel and can sign out', async ({ page, seed }) => {
    await signInToPanel(page, seed.viewer)
    await expect(
      page.getByRole('heading', { name: 'No access to the operator panel' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/operator\/login/)
  })

  test('signing in to the web app does not replace the session of the panel', async ({
    page,
    seed,
  }) => {
    await signInToPanel(page, seed.operator)
    await expect(page.getByText(seed.workCenter.name)).toBeVisible()
    const panelToken = await page.evaluate(() => localStorage.getItem('edmes.operator.token'))

    await signInToWeb(page, seed.admin)
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible()
    const tokens = await page.evaluate(() => ({
      web: localStorage.getItem('edmes.web.token'),
      operator: localStorage.getItem('edmes.operator.token'),
    }))
    expect(tokens.web).toBeTruthy()
    expect(tokens.operator).toBe(panelToken)
    expect(tokens.web).not.toBe(tokens.operator)

    // The panel is still the operator's, at the station
    await page.goto('/operator/')
    await expect(page.getByText(seed.workCenter.name)).toBeVisible()
  })
})
