import type { ApiClient, paths } from '@mes/api-client'

type WorkCentersListResponse =
  paths['/work-centers']['get']['responses'][200]['content']['application/json']

export type WorkCenter = WorkCentersListResponse['data'][number]

// The largest page the server returns; a user sees far fewer work centers than that.
const LIMIT = 100

export function workCentersListOptions(api: ApiClient, query: { status?: 'active' | 'archived' }) {
  return api.$api.queryOptions('get', '/work-centers', {
    params: { query: { ...(query.status ? { status: query.status } : {}), limit: LIMIT } },
  })
}
