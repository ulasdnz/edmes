import type { ApiClient, paths } from '@mes/api-client'
import { keepPreviousData } from '@tanstack/react-query'
import { z } from 'zod'

type UsersListResponse = paths['/users']['get']['responses'][200]['content']['application/json']

export type User = UsersListResponse['data'][number]

export const usersListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  size: z.union([z.literal(20), z.literal(50), z.literal(100)]).catch(20),
  sort: z.string().optional().catch(undefined),
  // The router reads ?search=1234 as a number; it is still the text that was searched for.
  search: z
    .preprocess(value => (typeof value === 'number' ? String(value) : value), z.string().max(100))
    .optional()
    .catch(undefined),
})

export type UsersListSearch = z.infer<typeof usersListSearchSchema>

export function toUsersQuery(search: UsersListSearch): {
  page: number
  limit: number
  sort?: string
  search?: string
} {
  return {
    page: search.page,
    limit: search.size,
    ...(search.sort ? { sort: search.sort } : {}),
    ...(search.search ? { search: search.search } : {}),
  }
}

const total = (response: UsersListResponse) => response.pagination.total

// Each count is a list request with room for one row: its pagination.total is the count
export function usersCountsOptions(api: ApiClient) {
  const count = (filter: { isActivated?: 'true'; withoutWorkCenter?: 'true' }) =>
    api.$api.queryOptions(
      'get',
      '/users',
      { params: { query: { limit: 1, ...filter } } },
      { select: total },
    )
  return {
    all: count({}),
    active: count({ isActivated: 'true' }),
    withoutWorkCenter: count({ withoutWorkCenter: 'true' }),
  }
}

export function usersListOptions(api: ApiClient, search: UsersListSearch) {
  return api.$api.queryOptions(
    'get',
    '/users',
    { params: { query: toUsersQuery(search) } },
    { placeholderData: keepPreviousData },
  )
}
