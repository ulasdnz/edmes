import { afterEach, describe, expect, it, vi } from 'vitest'
import { serveApi } from '../test/fake-api'
import { createTestCore, renderInApp } from '../test/render'
import { fakeToken, signIn } from '../test/session'
import { Topbar } from './topbar'

const user = {
  _id: '0123456789abcdef01234567',
  username: 'ayse.demir',
  email: 'ayse.demir@example.com',
  name: 'Ayşe',
  surname: 'Demir',
  language: 'en',
  workCenterIds: [],
  specialities: [],
  props: {},
  isActivated: true,
  isActiveDirectoryUser: false,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const roles = [
  { _id: 'r1', name: 'Planner', description: 'Plans and job orders.' },
  { _id: 'r2', name: 'Quality', description: null },
]

function serveMe() {
  return serveApi(request => {
    const populated = request.query.get('populate') === 'roles'
    return {
      body: {
        data: { ...user, roles: populated ? roles : roles.map(role => role._id) },
        meta: {
          plantTimezone: 'Europe/Istanbul',
          serverTime: new Date().toISOString(),
          permissions: ['accessWebApp'],
        },
      },
    }
  })
}

describe('top bar user menu', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // scenario: Web.userMenuProfile / happy path / name, role line, Profile and language, Log out
  it.each([
    ['en', 'User menu', 'Profile and language', 'Log out'],
    ['tr', 'Kullanıcı menüsü', 'Profil ve dil', 'Oturumu kapat'],
  ] as const)('shows the name, the role line, then Profile and language and Log out (%s)', async (language, menuLabel, profile, logOut) => {
    serveMe()
    const core = createTestCore()
    await signIn(core, fakeToken(new Date()))
    const screen = await renderInApp(<Topbar />, { core, language, router: true })

    await screen.getByRole('button', { name: menuLabel }).click()
    const menu = screen.getByRole('menu')
    await expect.element(menu).toBeVisible()
    await expect.element(menu.getByText('Planner, Quality', { exact: true })).toBeVisible()

    const items = menu.getByRole('menuitem').elements()
    expect(items.map(item => item.textContent)).toEqual([profile, logOut])
    expect(items[0]?.getAttribute('href')).toBe('/profile')

    // The name, then the role line, both above the items
    const text = menu.element().textContent ?? ''
    expect(text.indexOf('Ayşe Demir')).toBeLessThan(text.indexOf('Planner, Quality'))
    expect(text.indexOf('Planner, Quality')).toBeLessThan(text.indexOf(profile))
  })
})
