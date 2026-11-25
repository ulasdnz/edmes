import type { Query, QueryKey } from '@tanstack/react-query'

export type InvalidationMap = Readonly<Record<string, readonly string[]>>

export const invalidationMap: InvalidationMap = {
  user: ['/users'],
  role: ['/roles', '/users'],
  speciality: ['/specialities', '/users'],
  work_center: ['/work-centers'],
  job_order: ['/job-orders'],
}

export function pathsForEvent(eventType: string, map: InvalidationMap): readonly string[] {
  const entity = eventType.split('.')[0] ?? ''
  return Object.hasOwn(map, entity) ? (map[entity] ?? []) : []
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function eventWorkCenterIds(payload: Record<string, unknown>): string[] {
  const ids = new Set<string>()
  if (payload.workCenterId) ids.add(String(payload.workCenterId))
  if (payload.previousWorkCenterId) ids.add(String(payload.previousWorkCenterId))
  if (Array.isArray(payload.workCenterIds)) {
    for (const id of payload.workCenterIds) {
      if (typeof id === 'string' && id) ids.add(id)
    }
  }
  return [...ids]
}

export function queryWorkCenterIds(queryKey: QueryKey): string[] | null {
  const init = queryKey[2]
  const params = isRecord(init) && isRecord(init.params) ? init.params : undefined
  const path = isRecord(params?.path) ? params.path : undefined
  const query = isRecord(params?.query) ? params.query : undefined
  const ids = new Set<string>()
  if (typeof path?.workCenterId === 'string' && path.workCenterId) ids.add(path.workCenterId)
  if (typeof query?.workCenterId === 'string' && query.workCenterId) ids.add(query.workCenterId)
  if (typeof query?.workCenterIds === 'string') {
    for (const id of query.workCenterIds.split(',')) {
      if (id.trim()) ids.add(id.trim())
    }
  }
  return ids.size > 0 ? [...ids] : null
}

export function queryMatchesEvent(
  query: Pick<Query, 'queryKey' | 'meta'>,
  paths: readonly string[],
  eventIds: readonly string[],
): boolean {
  const [method, path] = query.queryKey
  if (method !== 'get' || typeof path !== 'string') return false
  if (!paths.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) return false
  if (query.meta?.realtime === false) return false
  if (eventIds.length === 0) return true
  const queryIds = queryWorkCenterIds(query.queryKey)
  return queryIds === null || queryIds.some(id => eventIds.includes(id))
}
