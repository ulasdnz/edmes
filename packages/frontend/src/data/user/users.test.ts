import { createApiClient } from '@mes/api-client'
import { describe, expect, it } from 'vitest'
import { toUsersQuery, usersListOptions, usersListSearchSchema } from './users'

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
