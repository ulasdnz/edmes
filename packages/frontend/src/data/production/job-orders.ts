import type { ApiClient, paths } from '@mes/api-client'

type JobOrdersListResponse =
  paths['/job-orders']['get']['responses'][200]['content']['application/json']

export type JobOrder = JobOrdersListResponse['data'][number]

// workCenterIds, not workCenterId: the realtime client reads it from the key, so only job order
// events of this work center refetch the query.
export function runningJobOrderOptions(api: ApiClient, workCenterId: string) {
  return api.$api.queryOptions(
    'get',
    '/job-orders',
    { params: { query: { workCenterIds: workCenterId, runtimeState: 'running', limit: 1 } } },
    { select: (response: JobOrdersListResponse): JobOrder | null => response.data[0] ?? null },
  )
}
