import { describe, expect, it, vi } from 'vitest'
import { renderWithI18n } from '../../test/render'
import { WorkCenterPicker } from './work-center-picker'

describe('WorkCenterPicker', () => {
  it('says so when no work center is assigned and offers sign-out', async () => {
    const onSelect = vi.fn()
    const onSignOut = vi.fn()
    const screen = await renderWithI18n(
      <WorkCenterPicker workCenters={[]} onSelect={onSelect} onSignOut={onSignOut} />,
    )
    await expect.element(screen.getByText('No work center is assigned to you')).toBeVisible()
    await screen.getByRole('button', { name: 'Sign out' }).click()
    expect(onSignOut).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })

  // scenario: workCenters: [] → the text is visible (no spinner) and "Sign out" calls onSignOut once
  it('shows the empty message without a spinner and signs out once', async () => {
    const onSignOut = vi.fn()
    const screen = await renderWithI18n(
      <WorkCenterPicker workCenters={[]} onSelect={vi.fn()} onSignOut={onSignOut} />,
    )
    await expect.element(screen.getByText('No work center is assigned to you')).toBeVisible()
    expect(screen.getByRole('progressbar').elements()).toHaveLength(0)
    expect(screen.getByRole('status').elements()).toHaveLength(0)
    await screen.getByRole('button', { name: 'Sign out' }).click()
    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('offers each work center as a target of at least 48 px', async () => {
    const onSelect = vi.fn()
    const onSignOut = vi.fn()
    const screen = await renderWithI18n(
      <WorkCenterPicker
        workCenters={[
          { _id: 'wc1', code: 'PRS-01', name: 'Press 1' },
          { _id: 'wc2', code: 'PRS-02', name: 'Press 2' },
        ]}
        onSelect={onSelect}
        onSignOut={onSignOut}
      />,
    )
    const first = screen.getByRole('button', { name: /Press 1/ })
    const second = screen.getByRole('button', { name: /Press 2/ })
    await expect.element(first).toBeVisible()
    await expect.element(second).toBeVisible()
    for (const target of [first, second, screen.getByRole('button', { name: 'Sign out' })]) {
      expect(target.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(48)
    }
    await second.click()
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('wc2')
  })
})
