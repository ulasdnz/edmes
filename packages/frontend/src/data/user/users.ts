import type { ApiClient, paths } from '@mes/api-client'
import { keepPreviousData } from '@tanstack/react-query'
import { z } from 'zod'

type UsersListResponse = paths['/users']['get']['responses'][200]['content']['application/json']

export type User = UsersListResponse['data'][number]

export const usersListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  size: z.union([z.literal(20), z.literal(50), z.literal(100)]).catch(20),
  sort: z.string().optional(),
  search: z.string().max(100).optional(),
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

export function usersListOptions(api: ApiClient, search: UsersListSearch) {
  return api.$api.queryOptions(
    'get',
    '/users',
    { params: { query: toUsersQuery(search) } },
    { placeholderData: keepPreviousData },
  )
}
