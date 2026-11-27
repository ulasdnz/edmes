import type { Me, MyRole } from '@mes/frontend/data/user/me'
import { Toaster } from '@mes/ui/components/sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { type ApiAnswer, type ApiRequest, serveApi } from '../../test/fake-api'
import { createTestCore, renderInApp } from '../../test/render'
import { fakeToken, signIn } from '../../test/session'
import { ProfilePage } from './profile-page'

const planner: MyRole = {
  _id: 'r1',
  name: 'Planner',
  description: 'Plans, job orders, schedules and product standards.',
}
const viewer: MyRole = { _id: 'r2', name: 'Viewer', description: null }

const ayse: Me = {
  _id: '0123456789abcdef01234567',
  username: 'ayse.demir',
  email: 'ayse.demir@example.com',
  name: 'Ayşe',
  surname: 'Demir',
  roles: ['r1', 'r2'],
  language: 'en',
  birthDate: '1989-04-17',
  workCenterIds: ['w1', 'w2', 'w3'],
  specialities: [],
  props: {},
  isActivated: true,
  isActiveDirectoryUser: false,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const workCenters = [
  { _id: 'w1', code: 'INJ-01', name: 'Injection 1', type: 'physical' },
  { _id: 'w2', code: 'INJ-02', name: 'Injection 2', type: 'physical' },
  { _id: 'w3', code: 'GBZ', name: 'Gebze Plant', type: 'virtual' },
]

// 04:58 UTC is 07:58 in the plant (Europe/Istanbul, UTC+3)
const issuedAt = new Date('2026-11-26T04:58:00.000Z')

interface Backend {
  user: Me
  permissions: string[]
  roles: MyRole[]
  asked: ApiRequest[]
}

// The user-service and work-center answers the page reads, over one user that PATCHes change
function serveProfile(
  options: {
    user?: Partial<Me>
    permissions?: string[]
    roles?: MyRole[]
    answer?: (request: ApiRequest, backend: Backend) => ApiAnswer | undefined
  } = {},
): Backend {
  const backend: Backend = {
    user: { ...ayse, ...options.user },
    permissions: options.permissions ?? ['accessWebApp', 'readWorkCenters'],
    roles: options.roles ?? [planner, viewer],
    asked: [],
  }
  backend.asked = serveApi(request => {
    const custom = options.answer?.(request, backend)
    if (custom) return custom
    const meta = {
      plantTimezone: 'Europe/Istanbul',
      serverTime: new Date().toISOString(),
      permissions: backend.permissions,
    }
    if (request.path === '/users/me' && request.method === 'GET') {
      const populated = request.query.get('populate') === 'roles'
      return {
        body: {
          data: { ...backend.user, roles: populated ? backend.roles : backend.user.roles },
          meta,
        },
      }
    }
    if (request.path === '/users/me' && request.method === 'PATCH') {
      backend.user = {
        ...backend.user,
        ...JSON.parse(request.body),
        updatedAt: new Date().toISOString(),
      }
      return { body: { data: backend.user, message: 'User updated successfully' } }
    }
    if (request.path === '/users/me/avatar' && request.method === 'DELETE') {
      backend.user = { ...backend.user, photoUrl: null, updatedAt: new Date().toISOString() }
      return { body: { data: backend.user, message: 'Avatar removed' } }
    }
    if (request.path === '/work-centers') {
      return {
        body: {
          data: workCenters.map(wc => ({ ...wc, status: 'active' })),
          pagination: { page: 1, limit: 100, total: workCenters.length, totalPages: 1 },
        },
      }
    }
    return { status: 404, body: { error: { code: 'test.not_served', message: request.path } } }
  })
  return backend
}

async function renderProfile(options: Parameters<typeof serveProfile>[0] = {}) {
  const backend = serveProfile(options)
  const core = createTestCore()
  await signIn(core, fakeToken(issuedAt))
  const screen = await renderInApp(
    <>
      <ProfilePage />
      <Toaster />
    </>,
    { core },
  )
  await expect.element(screen.getByLabelText('Name', { exact: true })).toHaveValue('Ayşe')
  return { screen, backend, core }
}

type Screen = Awaited<ReturnType<typeof renderProfile>>['screen']

const details = (screen: Screen) => screen.getByRole('region', { name: 'Personal details' })
const save = (screen: Screen) => screen.getByRole('button', { name: 'Save profile' })
const discard = (screen: Screen) => screen.getByRole('button', { name: 'Discard changes' })
const patches = (backend: Backend) =>
  backend.asked.filter(request => request.method === 'PATCH' && request.path === '/users/me')

function optionsOf(screen: Screen, label: string): string[] {
  const select = screen.getByLabelText(label, { exact: true }).element() as HTMLSelectElement
  return [...select.options].map(option => option.text)
}

function describedBy(screen: Screen, label: string): string {
  const input = screen.getByLabelText(label, { exact: true }).element()
  return (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ')
}

describe('profile page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // scenario: Web.profilePage / happy path / heading, signed in as <username> since HH:mm, Log out
  it('shows the heading, who is signed in since the token was issued, and Log out', async () => {
    const { screen } = await renderProfile()

    const heading = screen.getByRole('heading', { level: 1, name: 'Profile' })
    await expect.element(heading).toBeVisible()
    const line = heading.element().parentElement?.querySelector('p')
    expect(line?.textContent).toBe('Your own account · signed in as ayse.demir since 07:58')
    await expect.element(screen.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  // scenario: Web.profilePage / happy path / Personal details fields
  it('shows the personal details fields as the canvas draws them', async () => {
    const { screen } = await renderProfile()

    await expect.element(screen.getByLabelText('Name', { exact: true })).toBeRequired()
    await expect.element(screen.getByLabelText('Surname', { exact: true })).toHaveValue('Demir')
    await expect.element(screen.getByLabelText('Surname', { exact: true })).toBeRequired()
    const username = screen.getByLabelText('Username', { exact: true })
    await expect.element(username).toHaveValue('ayse.demir')
    await expect.element(username).toHaveAttribute('readonly')
    expect(username.element().parentElement?.querySelector('svg.lucide-lock')).not.toBeNull()
    expect(describedBy(screen, 'Username')).toBe('Only an administrator can change your username.')
    await expect
      .element(screen.getByLabelText('Email', { exact: true }))
      .toHaveValue('ayse.demir@example.com')
    await expect.element(screen.getByLabelText('Email', { exact: true })).toBeRequired()
    expect(optionsOf(screen, 'Language')).toEqual(['English', 'Türkçe'])
    expect(describedBy(screen, 'Language')).toBe(
      'Also sets how numbers, dates and durations are written. Times always stay in plant time.',
    )
    // Not set yet: empty, then the two values
    expect(optionsOf(screen, 'Gender')).toEqual(['', 'Female', 'Male'])
    await expect.element(screen.getByLabelText('Gender', { exact: true })).toHaveValue('')
    await expect
      .element(screen.getByLabelText('Birth date', { exact: true }))
      .toHaveValue('1989-04-17')
  })

  // scenario: Web.profilePage / boundaries / Gender offers exactly Female and Male
  it('offers exactly Female and Male once a gender is set', async () => {
    const { screen } = await renderProfile({ user: { gender: 'female' } })

    expect(optionsOf(screen, 'Gender')).toEqual(['Female', 'Male'])
    await expect.element(screen.getByLabelText('Gender', { exact: true })).toHaveValue('female')
  })

  // scenario: Web.profilePage / happy path / Save sends only the changed fields, saved values, toast
  it('saves only the changed fields and shows the saved values with a toast', async () => {
    const { screen, backend } = await renderProfile()
    const surname = screen.getByLabelText('Surname', { exact: true })

    await surname.fill('Yılmaz')
    await screen.getByLabelText('Gender', { exact: true }).selectOptions('Female')
    await save(screen).click()

    await vi.waitFor(() => expect(patches(backend)).toHaveLength(1))
    expect(JSON.parse(patches(backend)[0]?.body ?? '')).toEqual({
      surname: 'Yılmaz',
      gender: 'female',
    })
    await expect.element(screen.getByText('Your profile was saved.')).toBeVisible()
    await expect.element(surname).toHaveValue('Yılmaz')
    await expect.element(screen.getByLabelText('Gender', { exact: true })).toHaveValue('female')
    await expect.element(save(screen)).toBeDisabled()
  })

  // scenario: Web.profilePage / happy path / saving another language switches the app at once
  it('switches the app to the saved language at once', async () => {
    const { screen, backend } = await renderProfile()

    await screen.getByLabelText('Language', { exact: true }).selectOptions('Türkçe')
    await save(screen).click()

    await expect.element(screen.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    expect(JSON.parse(patches(backend)[0]?.body ?? '')).toEqual({ language: 'tr' })
    await expect.element(screen.getByRole('button', { name: 'Profili kaydet' })).toBeVisible()
  })

  // scenario: Web.profilePage / happy path / Your roles and Your work centers cards
  it('lists the roles read only, and the work centers with the physical and virtual counts', async () => {
    const { screen } = await renderProfile()

    const roles = screen.getByRole('region', { name: 'Your roles' })
    await expect.element(roles.getByText('Planner', { exact: true })).toBeVisible()
    await expect
      .element(roles.getByText('Plans, job orders, schedules and product standards.'))
      .toBeVisible()
    await expect.element(roles.getByText('Viewer', { exact: true })).toBeVisible()
    await expect.element(roles.getByText('Read only')).toBeVisible()

    const centers = screen.getByRole('region', { name: 'Your work centers' })
    await expect.element(centers.getByText('2 physical · 1 virtual')).toBeVisible()
    await expect.element(centers.getByText('INJ-01', { exact: true })).toBeVisible()
    await expect.element(centers.getByText('INJ-02', { exact: true })).toBeVisible()
    await expect.element(centers.getByText('Gebze Plant', { exact: true })).toBeVisible()
    await expect.element(centers.getByText('Virtual', { exact: true })).toBeVisible()
  })

  // scenario: Web.profilePage / boundaries / no avatar → initials, Remove disabled; Remove → initials back
  it('shows the initials with Remove disabled, and removes an avatar', async () => {
    const { screen, backend } = await renderProfile({ user: { photoUrl: '/uploads/face.png' } })
    const remove = details(screen).getByRole('button', { name: 'Remove' })

    await expect.element(details(screen).getByRole('img', { name: 'Your photo' })).toBeVisible()
    await expect.element(remove).toBeEnabled()
    await remove.click()

    await vi.waitFor(() =>
      expect(backend.asked.some(r => r.method === 'DELETE' && r.path === '/users/me/avatar')).toBe(
        true,
      ),
    )
    await expect.element(details(screen).getByText('AD', { exact: true })).toBeVisible()
    expect(details(screen).getByRole('img', { name: 'Your photo' }).query()).toBeNull()
    await expect.element(remove).toBeDisabled()
    await expect
      .element(
        details(screen).getByText(
          'No photo yet, so your initials are shown. PNG or JPG, up to 2 MB.',
        ),
      )
      .toBeVisible()
  })

  // scenario: Web.profilePage / edge cases / 400 with details → banner and each message under its field
  it('shows the banner and the server messages under their fields when the save is refused', async () => {
    const { screen } = await renderProfile({
      answer: request =>
        request.method === 'PATCH'
          ? {
              status: 400,
              body: {
                error: {
                  code: 'error.validation_failed',
                  message: 'Validation failed.',
                  details: [
                    {
                      field: 'email',
                      message: 'Enter a complete email address, for example name@company.com.',
                    },
                    { field: 'surname', message: 'Surname is required' },
                  ],
                },
              },
            }
          : undefined,
    })

    await screen.getByLabelText('Email', { exact: true }).fill('ayse.demir@gebze.com.tr')
    await save(screen).click()

    const banner = details(screen).getByRole('alert')
    await expect
      .element(banner.getByText('Your profile was not saved.', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByLabelText('Email', { exact: true }))
      .toHaveAttribute('aria-invalid', 'true')
    expect(describedBy(screen, 'Email')).toBe(
      'Enter a complete email address, for example name@company.com.',
    )
    expect(describedBy(screen, 'Surname')).toBe('Surname is required')
  })

  // scenario: Web.profilePage / edge cases / the email message from the client's own check
  it('checks the email itself before sending anything', async () => {
    const { screen, backend } = await renderProfile()

    await screen.getByLabelText('Email', { exact: true }).fill('ayse.demir@gebze')
    await save(screen).click()

    await vi.waitFor(() =>
      expect(describedBy(screen, 'Email')).toBe(
        'Enter a complete email address, for example name@company.com.',
      ),
    )
    expect(patches(backend)).toHaveLength(0)
  })

  // scenario: Web.profilePage / edge cases / Discard puts back the stored values; Save only after a change
  it('enables Save only after a change, and Discard puts back the stored values', async () => {
    const { screen } = await renderProfile()
    const name = screen.getByLabelText('Name', { exact: true })

    await expect.element(save(screen)).toBeDisabled()
    await name.fill('Ayşegül')
    await expect.element(save(screen)).toBeEnabled()
    await discard(screen).click()

    await expect.element(name).toHaveValue('Ayşe')
    await expect.element(save(screen)).toBeDisabled()
    // Typing the stored value back is no change either
    await name.fill('Ayşe!')
    await name.fill('Ayşe')
    await expect.element(save(screen)).toBeDisabled()
  })

  // scenario: Web.profilePage / edge cases / not PNG or JPG, or over 2 MB → server message, avatar stays
  it.each([
    [
      'a file that is not PNG or JPG',
      new File(['GIF89a'], 'face.gif', { type: 'image/gif' }),
      'upload.only_images',
      'Only PNG or JPG images are allowed',
    ],
    [
      'a file over 2 MB',
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
      'upload.file_too_large',
      'File must be 2 MB or smaller',
    ],
  ])('shows the server message under the avatar for %s and keeps the avatar', async (_case, file, code, message) => {
    const { screen, backend } = await renderProfile({
      user: { photoUrl: '/uploads/face.png' },
      answer: request =>
        request.path === '/users/me/avatar' && request.method === 'PATCH'
          ? { status: 400, body: { error: { code, message } } }
          : undefined,
    })
    const input = details(screen).element().querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input')

    await userEvent.upload(input, file)

    await expect.element(details(screen).getByText(message)).toBeVisible()
    await expect.element(details(screen).getByRole('img', { name: 'Your photo' })).toBeVisible()
    expect(backend.user.photoUrl).toBe('/uploads/face.png')
  })

  // scenario: Web.profilePage / edge cases / no permission needed beyond being signed in
  it('opens for a signed-in user with no permission at all', async () => {
    const { screen, backend } = await renderProfile({ permissions: [] })

    await expect.element(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
    await expect.element(details(screen)).toBeVisible()
    const centers = screen.getByRole('region', { name: 'Your work centers' })
    await expect.element(centers.getByText('3 work centers')).toBeVisible()
    expect(backend.asked.some(request => request.path === '/work-centers')).toBe(false)
  })
})
