import type { User } from '@mes/frontend/data/user/users'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { type ApiAnswer, type ApiRequest, serveApi, unavailable } from '../../test/fake-api'
import { createTestCore, renderInApp, renderWithI18n } from '../../test/render'
import { SearchBox, UsersPage, useLastPageCorrection } from './users-page'

function Correction(props: Parameters<typeof useLastPageCorrection>[0]) {
  useLastPageCorrection(props)
  return null
}

// Commits arrive back as the value later, the way the router updates the address.
function SearchWithSlowAddress(props: { onCommit: (value: string | undefined) => void }) {
  const [value, setValue] = useState<string | undefined>()
  return (
    <SearchBox
      value={value}
      onChange={next => {
        props.onCommit(next)
        setTimeout(() => setValue(next), 200)
      }}
    />
  )
}

describe('users page', () => {
  it('moves a page past the last one back without a new history entry', async () => {
    const onSearchChange = vi.fn()
    const screen = await renderWithI18n(
      <Correction page={5} totalPages={3} onSearchChange={onSearchChange} />,
    )
    await vi.waitFor(() => expect(onSearchChange).toHaveBeenCalled())
    expect(onSearchChange).toHaveBeenCalledOnce()
    expect(onSearchChange).toHaveBeenCalledWith({ page: 3 }, { replace: true })
    await screen.rerender(<Correction page={3} totalPages={3} onSearchChange={onSearchChange} />)
    expect(onSearchChange).toHaveBeenCalledOnce()
  })

  it('leaves a page within the list alone', async () => {
    const onSearchChange = vi.fn()
    await renderWithI18n(<Correction page={2} totalPages={3} onSearchChange={onSearchChange} />)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(onSearchChange).not.toHaveBeenCalled()
  })

  it('keeps what is typed while the address catches up with the search', async () => {
    const onCommit = vi.fn()
    const screen = await renderWithI18n(<SearchWithSlowAddress onCommit={onCommit} />)
    const box = screen.getByRole('searchbox', { name: 'Search users' })
    await box.fill('ada')
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledWith('ada'))
    await userEvent.type(box, ' lovelace')
    await vi.waitFor(() => expect(onCommit).toHaveBeenLastCalledWith('ada lovelace'), {
      timeout: 2000,
    })
    await expect.element(box).toHaveValue('ada lovelace')
  })
})

const ada: User = {
  _id: '0123456789abcdef01234567',
  username: 'ada',
  email: 'ada@example.com',
  name: 'Ada',
  surname: 'Lovelace',
  roles: [],
  language: 'en',
  workCenterIds: ['w1'],
  specialities: [],
  props: {},
  isActivated: true,
  isActiveDirectoryUser: false,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function page(total: number, limit: number): ApiAnswer {
  return {
    body: {
      data: limit === 1 ? [] : [ada],
      pagination: { page: 1, limit, total, totalPages: Math.ceil(total / limit) },
    },
  }
}

const isCount = (request: ApiRequest) =>
  request.path === '/users' && request.query.get('limit') === '1'

// The three counts the subtitle reads, and a list whose own total differs from all of them
function serveUsers(
  counts: { all: number; active: number; withoutWorkCenter: number },
  countAnswer?: (request: ApiRequest) => ApiAnswer | Promise<ApiAnswer>,
) {
  return serveApi(request => {
    if (!isCount(request)) return page(7, Number(request.query.get('limit') ?? 20))
    if (countAnswer) return countAnswer(request)
    if (request.query.get('withoutWorkCenter') === 'true') return page(counts.withoutWorkCenter, 1)
    if (request.query.get('isActivated') === 'true') return page(counts.active, 1)
    return page(counts.all, 1)
  })
}

const firstPage = { page: 1, size: 20 } as const

function subtitleOf(screen: Awaited<ReturnType<typeof renderInApp>>) {
  const block = screen.getByRole('heading', { level: 1 }).element().parentElement
  if (!block) throw new Error('the page heading has no block')
  return block
}

describe('users page subtitle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // scenario: Web.usersSubtitle / happy path / 23 total, 21 active, 1 without a work center
  it.each([
    ['en', '23 users · 21 active · 1 without any work center'],
    ['tr', '23 kullanıcı · 21 etkin · 1 iş merkezi olmayan'],
  ] as const)('reads the three counts (%s)', async (language, expected) => {
    serveUsers({ all: 23, active: 21, withoutWorkCenter: 1 })
    const screen = await renderInApp(<UsersPage search={firstPage} onSearchChange={() => {}} />, {
      language,
    })

    await expect.element(screen.getByText(expected, { exact: true })).toBeVisible()
  })

  // scenario: Web.usersSubtitle / boundaries / 0 without a work center → that part left out
  it('leaves out the part without a work center at 0', async () => {
    serveUsers({ all: 23, active: 21, withoutWorkCenter: 0 })
    const screen = await renderInApp(<UsersPage search={firstPage} onSearchChange={() => {}} />)

    await expect.element(screen.getByText('23 users · 21 active', { exact: true })).toBeVisible()
    expect(screen.getByText(/without any work center/).elements()).toHaveLength(0)
  })

  // scenario: Web.usersSubtitle / boundaries / 1 user, 1 active → singular
  it('says one user in the singular', async () => {
    serveUsers({ all: 1, active: 1, withoutWorkCenter: 0 })
    const screen = await renderInApp(<UsersPage search={firstPage} onSearchChange={() => {}} />)

    await expect.element(screen.getByText('1 user · 1 active', { exact: true })).toBeVisible()
  })

  // scenario: Web.usersSubtitle / edge cases / counts still loading → a skeleton, never a 0
  it('shows a skeleton while the counts load, never a 0', async () => {
    serveUsers({ all: 0, active: 0, withoutWorkCenter: 0 }, () => new Promise<never>(() => {}))
    const screen = await renderInApp(<UsersPage search={firstPage} onSearchChange={() => {}} />)

    await expect.element(screen.getByRole('table', { name: 'Users' })).toBeVisible()
    const block = subtitleOf(screen)
    expect(block.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(block.textContent).not.toMatch(/\d/)
  })

  // scenario: Web.usersSubtitle / edge cases / the count requests fail → subtitle left out
  it('leaves the subtitle out when the counts fail, and the table still shows', async () => {
    const asked = serveUsers({ all: 0, active: 0, withoutWorkCenter: 0 }, () => unavailable)
    const screen = await renderInApp(<UsersPage search={firstPage} onSearchChange={() => {}} />)

    await expect.element(screen.getByRole('table', { name: 'Users' })).toBeVisible()
    await vi.waitFor(() => expect(asked.filter(isCount)).toHaveLength(3))
    await vi.waitFor(() =>
      expect(subtitleOf(screen).querySelector('[data-slot="skeleton"]')).toBeNull(),
    )
    expect(subtitleOf(screen).textContent).toBe('Users')
    await expect.element(screen.getByText('ada@example.com')).toBeVisible()
  })

  // A refetch after a realtime event that fails (a service restarting) keeps the counts shown
  it('keeps the counts it has when a later refetch fails', async () => {
    let failing = false
    const counts = { all: 23, active: 21, withoutWorkCenter: 1 }
    const asked = serveUsers(counts, request => {
      if (failing) return unavailable
      if (request.query.get('withoutWorkCenter') === 'true')
        return page(counts.withoutWorkCenter, 1)
      if (request.query.get('isActivated') === 'true') return page(counts.active, 1)
      return page(counts.all, 1)
    })
    const core = createTestCore()
    const screen = await renderInApp(<UsersPage search={firstPage} onSearchChange={() => {}} />, {
      core,
    })
    const expected = '23 users · 21 active · 1 without any work center'
    await expect.element(screen.getByText(expected, { exact: true })).toBeVisible()

    failing = true
    await core.queryClient.invalidateQueries({ queryKey: ['get', '/users'] })
    await vi.waitFor(() => expect(asked.filter(isCount)).toHaveLength(6))
    const failed = () =>
      core.queryClient
        .getQueryCache()
        .findAll({ queryKey: ['get', '/users'] })
        .filter(query => query.state.status === 'error')
    await vi.waitFor(() => expect(failed()).toHaveLength(3))
    // Let React render the error state before looking, once
    await new Promise(resolve => setTimeout(resolve, 300))

    expect(screen.getByText(expected, { exact: true }).query()).not.toBeNull()
  })

  // scenario: Web.usersSubtitle / edge cases / the counts ignore the search box and the page
  it('counts every user, whatever the search and the page', async () => {
    const asked = serveUsers({ all: 23, active: 21, withoutWorkCenter: 1 })
    const expected = '23 users · 21 active · 1 without any work center'
    const screen = await renderInApp(
      <UsersPage search={{ page: 2, size: 50, search: 'ada' }} onSearchChange={() => {}} />,
    )
    await expect.element(screen.getByText(expected, { exact: true })).toBeVisible()

    await screen.rerender(
      <UsersPage search={{ page: 3, size: 20, search: 'grace' }} onSearchChange={() => {}} />,
    )
    await vi.waitFor(() =>
      expect(asked.some(request => request.query.get('search') === 'grace')).toBe(true),
    )

    await expect.element(screen.getByText(expected, { exact: true })).toBeVisible()
    const counts = asked.filter(isCount).map(request => request.query.toString())
    expect(counts.sort()).toEqual([
      'limit=1',
      'limit=1&isActivated=true',
      'limit=1&withoutWorkCenter=true',
    ])
  })
})
