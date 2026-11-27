import type { User } from '@mes/frontend/data/user/users'
import { describe, expect, it, vi } from 'vitest'
import { renderWithI18n } from '../../test/render'
import { UsersTable } from './users-table'

function user(overrides: Partial<User>): User {
  return {
    _id: '0123456789abcdef01234567',
    username: 'ada',
    email: 'ada@example.com',
    name: 'Ada',
    surname: 'Lovelace',
    roles: ['r1'],
    language: 'en',
    workCenterIds: ['w1', 'w2'],
    specialities: [],
    props: {},
    isActivated: true,
    isActiveDirectoryUser: false,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const twoUsers = [
  user({}),
  user({
    _id: '0123456789abcdef01234568',
    username: 'grace',
    email: 'grace@example.com',
    name: 'Grace',
    surname: 'Hopper',
    workCenterIds: [],
    isActivated: false,
  }),
]

const noop = () => {}

describe('UsersTable', () => {
  it('shows one row per user', async () => {
    const screen = await renderWithI18n(
      <UsersTable
        rows={twoUsers}
        pagination={{ page: 1, limit: 20, total: 2, totalPages: 1 }}
        onPageChange={noop}
        onSizeChange={noop}
      />,
    )
    await expect.element(screen.getByRole('table', { name: 'Users' })).toBeVisible()
    await expect.element(screen.getByText('ada@example.com')).toBeVisible()
    await expect.element(screen.getByText('grace@example.com')).toBeVisible()
    await expect.element(screen.getByText('Ada Lovelace')).toBeVisible()
    await expect.element(screen.getByText('Inactive')).toBeVisible()
    expect(screen.getByRole('row').elements()).toHaveLength(3)
  })

  it('shows the empty state for no rows', async () => {
    const screen = await renderWithI18n(
      <UsersTable
        rows={[]}
        pagination={{ page: 1, limit: 20, total: 0, totalPages: 0 }}
        onPageChange={noop}
        onSizeChange={noop}
      />,
    )
    await expect.element(screen.getByText('No users found')).toBeVisible()
  })

  it('asks for the next page', async () => {
    const onPageChange = vi.fn()
    const screen = await renderWithI18n(
      <UsersTable
        rows={twoUsers}
        pagination={{ page: 1, limit: 20, total: 45, totalPages: 3 }}
        onPageChange={onPageChange}
        onSizeChange={noop}
      />,
    )
    await expect.element(screen.getByText('Showing 1–20 of 45')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await screen.getByRole('button', { name: 'Next page' }).click()
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('asks for another page size', async () => {
    const onSizeChange = vi.fn()
    const screen = await renderWithI18n(
      <UsersTable
        rows={twoUsers}
        pagination={{ page: 1, limit: 20, total: 45, totalPages: 3 }}
        onPageChange={noop}
        onSizeChange={onSizeChange}
      />,
    )
    await screen.getByRole('combobox', { name: 'Rows per page' }).selectOptions('50')
    expect(onSizeChange).toHaveBeenCalledWith(50)
  })

  function activeCell(screen: Awaited<ReturnType<typeof renderWithI18n>>, rowName: string) {
    const row = screen.getByRole('row').filter({ hasText: rowName }).element()
    const cells = row.querySelectorAll('td')
    const cell = cells[cells.length - 1]
    if (!cell) throw new Error(`no cells in the row of ${rowName}`)
    return cell
  }

  // scenario: Web.usersActivePill / happy path / Active pill with a check, Inactive with a cross
  it.each([
    ['en', 'Active', 'Inactive'],
    ['tr', 'Etkin', 'Etkin değil'],
  ] as const)('shows the Active column as status pills (%s)', async (language, active, inactive) => {
    const screen = await renderWithI18n(
      <UsersTable
        rows={twoUsers}
        pagination={{ page: 1, limit: 20, total: 2, totalPages: 1 }}
        onPageChange={noop}
        onSizeChange={noop}
      />,
      language,
    )
    await expect.element(screen.getByRole('table')).toBeVisible()
    const on = activeCell(screen, 'Ada Lovelace').querySelector('[data-slot="status-pill"]')
    const off = activeCell(screen, 'Grace Hopper').querySelector('[data-slot="status-pill"]')
    expect(on?.textContent).toBe(active)
    expect(off?.textContent).toBe(inactive)
    expect(on?.querySelector('[data-mark="check"]')).not.toBeNull()
    expect(off?.querySelector('[data-mark="cross"]')).not.toBeNull()
  })

  // scenario: Web.usersActivePill / constraints / the pills differ by mark and by colour
  it('tells the two pills apart by their mark as well as their colour', async () => {
    const screen = await renderWithI18n(
      <UsersTable
        rows={twoUsers}
        pagination={{ page: 1, limit: 20, total: 2, totalPages: 1 }}
        onPageChange={noop}
        onSizeChange={noop}
      />,
    )
    await expect.element(screen.getByRole('table')).toBeVisible()
    const on = activeCell(screen, 'Ada Lovelace').querySelector('[data-slot="status-pill"]')
    const off = activeCell(screen, 'Grace Hopper').querySelector('[data-slot="status-pill"]')
    if (!on || !off) throw new Error('a status pill is missing')
    const onMark = on.querySelector<HTMLElement>('[data-mark]')
    const offMark = off.querySelector<HTMLElement>('[data-mark]')
    if (!onMark || !offMark) throw new Error('a pill has no mark')
    // The mark is an element inside the pill, drawn and seen
    for (const mark of [onMark, offMark]) {
      const box = mark.getBoundingClientRect()
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
    }
    expect(onMark.dataset.mark).not.toBe(offMark.dataset.mark)
    expect(getComputedStyle(onMark).clipPath).not.toBe(getComputedStyle(offMark).clipPath)
    expect(getComputedStyle(on).backgroundColor).not.toBe(getComputedStyle(off).backgroundColor)
    expect(getComputedStyle(on).color).not.toBe(getComputedStyle(off).color)
  })
})
