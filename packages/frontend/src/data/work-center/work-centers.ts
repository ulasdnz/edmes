import type { ApiClient, paths } from '@mes/api-client'

type WorkCentersListResponse =
  paths['/work-centers']['get']['responses'][200]['content']['application/json']

export type WorkCenter = WorkCentersListResponse['data'][number]

// The largest page the server returns
const LIMIT = 100

// Every page, one after another: the operator panel forgets a station that is not in this list,
// so a list cut at the first page would clear a station that still exists.
export function workCentersListOptions(api: ApiClient, query: { status?: 'active' | 'archived' }) {
  const filter = { ...(query.status ? { status: query.status } : {}), limit: LIMIT }
  return {
    ...api.$api.queryOptions('get', '/work-centers', { params: { query: filter } }),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<WorkCentersListResponse> => {
      const all: WorkCenter[] = []
      for (let page = 1; ; page++) {
        const { data, error } = await api.fetchClient.GET('/work-centers', {
          signal,
          params: { query: { ...filter, page } },
        })
        if (error || !data) throw error ?? new Error('the work center list answered no body')
        all.push(...data.data)
        if (page >= data.pagination.totalPages) {
          return { data: all, pagination: { ...data.pagination, page: 1, limit: all.length } }
        }
      }
    },
  }
}
