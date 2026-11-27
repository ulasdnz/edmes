import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApiClient } from '@mes/api-client'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { toUsersQuery, usersCountsOptions, usersListOptions, usersListSearchSchema } from './users'

describe('users list', () => {
  it('maps the URL search to the list request', () => {
    expect(toUsersQuery({ page: 2, size: 50, sort: '-createdAt' })).toEqual({
      page: 2,
      limit: 50,
      sort: '-createdAt',
    })
  })

  it('leaves out an empty search', () => {
    expect(toUsersQuery({ page: 1, size: 20, search: '' })).toEqual({ page: 1, limit: 20 })
  })

  it('falls back for a hand-edited URL', () => {
    expect(usersListSearchSchema.parse({ page: '3', size: 7 })).toEqual({ page: 3, size: 20 })
    expect(usersListSearchSchema.parse({ page: '-1', size: '50' })).toEqual({ page: 1, size: 20 })
    expect(usersListSearchSchema.parse({})).toEqual({ page: 1, size: 20 })
  })

  it('falls back for every hand-edited key instead of failing', () => {
    // the router parses ?search=1234 as a number
    expect(usersListSearchSchema.parse({ search: 1234 })).toEqual({
      page: 1,
      size: 20,
      search: '1234',
    })
    expect(usersListSearchSchema.parse({ search: 'a'.repeat(101) })).toEqual({ page: 1, size: 20 })
    expect(usersListSearchSchema.parse({ sort: 5 })).toEqual({ page: 1, size: 20 })
  })

  // scenario: page: 0 or a non-numeric page → page: 1
  it('falls back to page 1 for page 0 or a non-numeric page', () => {
    expect(usersListSearchSchema.parse({ page: 0 })).toEqual({ page: 1, size: 20 })
    expect(usersListSearchSchema.parse({ page: 'abc' })).toEqual({ page: 1, size: 20 })
  })

  // scenario: size of 20, 50 or 100 → kept; any other value → 20
  it('keeps a size of 20, 50 or 100 and falls back to 20 for any other', () => {
    for (const size of [20, 50, 100]) {
      expect(usersListSearchSchema.parse({ size })).toEqual({ page: 1, size })
    }
    for (const size of [7, 0, 25, 200, -50, 'big']) {
      expect(usersListSearchSchema.parse({ size })).toEqual({ page: 1, size: 20 })
    }
  })

  // scenario: search of 100 characters → accepted; 101 characters → dropped, parse does not throw
  it('accepts a 100-character search and drops a 101-character one without throwing', () => {
    const hundred = 'a'.repeat(100)
    expect(usersListSearchSchema.parse({ search: hundred })).toEqual({
      page: 1,
      size: 20,
      search: hundred,
    })
    expect(() => usersListSearchSchema.parse({ search: 'a'.repeat(101) })).not.toThrow()
    expect(usersListSearchSchema.parse({ search: 'a'.repeat(101) })).toEqual({ page: 1, size: 20 })
  })

  it('keeps the rows of the previous request while the next one loads', () => {
    const api = createApiClient({
      getToken: () => null,
      getLocale: () => 'en',
      onUnauthorized: () => {},
    })
    const options = usersListOptions(api, { page: 2, size: 50 })
    expect(options.queryKey).toEqual([
      'get',
      '/users',
      { params: { query: { page: 2, limit: 50 } } },
    ])
    const previous = { data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } }
    expect(typeof options.placeholderData).toBe('function')
    expect((options.placeholderData as (previous: unknown) => unknown)(previous)).toBe(previous)
  })
})

describe('users counts', () => {
  let server: Server | undefined
  const asked: string[] = []

  afterEach(async () => {
    asked.length = 0
    await new Promise(resolve => server?.close(resolve))
  })

  // Answers a total per filter, the way user-service counts: limit=1 holds one row at most
  async function serve(totals: { all: number; active: number; withoutWorkCenter: number }) {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      asked.push(`${url.pathname}${url.search}`)
      const query = url.searchParams
      const total =
        query.get('withoutWorkCenter') === 'true'
          ? totals.withoutWorkCenter
          : query.get('isActivated') === 'true'
            ? totals.active
            : totals.all
      const limit = Number(query.get('limit') ?? 20)
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          data: [],
          pagination: { page: 1, limit, total, totalPages: Math.ceil(total / limit) },
        }),
      )
    })
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    return createApiClient({
      baseUrl: `http://127.0.0.1:${port}`,
      getToken: () => null,
      getLocale: () => 'en',
      onUnauthorized: () => {},
    })
  }

  // scenario: Web.usersCountsQuery / happy path / three limit=1 requests, each pagination.total
  it('reads the three counts with limit=1 and takes each pagination.total', async () => {
    const client = await serve({ all: 23, active: 21, withoutWorkCenter: 1 })
    const queryClient = new QueryClient()
    const options = usersCountsOptions(client)

    const all = await queryClient.fetchQuery(options.all)
    const active = await queryClient.fetchQuery(options.active)
    const withoutWorkCenter = await queryClient.fetchQuery(options.withoutWorkCenter)

    expect(options.all.select?.(all)).toBe(23)
    expect(options.active.select?.(active)).toBe(21)
    expect(options.withoutWorkCenter.select?.(withoutWorkCenter)).toBe(1)
    expect([...asked].sort()).toEqual([
      '/users?limit=1',
      '/users?limit=1&isActivated=true',
      '/users?limit=1&withoutWorkCenter=true',
    ])
  })

  // scenario: Web.usersCountsQuery / constraints / keys start with ['get', '/users', …]
  it('keys every count under get /users, so a user event refetches it like the list', () => {
    const api = createApiClient({
      getToken: () => null,
      getLocale: () => 'en',
      onUnauthorized: () => {},
    })
    const options = usersCountsOptions(api)
    for (const count of [options.all, options.active, options.withoutWorkCenter]) {
      expect(count.queryKey.slice(0, 2)).toEqual(['get', '/users'])
    }
    expect(options.all.queryKey[2]).toEqual({ params: { query: { limit: 1 } } })
    expect(options.active.queryKey[2]).toEqual({
      params: { query: { limit: 1, isActivated: 'true' } },
    })
    expect(options.withoutWorkCenter.queryKey[2]).toEqual({
      params: { query: { limit: 1, withoutWorkCenter: 'true' } },
    })
  })
})
