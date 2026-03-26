import { config } from '../config/index.js'
import { cacheDel, cacheWrapDedup } from './cache.js'
import { logger } from './logger.js'

const USER_API = config.INTERNAL_API_USER
const WC_API = config.INTERNAL_API_WORK_CENTER

async function fetchInternal(
  baseUrl: string,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
}

// ── User service calls ──────────────────────────────────────────────────────

const VISIBILITY_TTL = 300 // 5 minutes

export async function getUserWorkCenterIds(userId: string): Promise<string[] | null> {
  try {
    return await cacheWrapDedup<string[] | null>(`user:wc:${userId}`, VISIBILITY_TTL, async () => {
      const res = await fetchInternal(USER_API, `/users/${userId}`)
      if (!res.ok) return null
      const body = (await res.json()) as { data?: { workCenterIds?: string[] } }
      return body.data?.workCenterIds?.map(String) ?? []
    })
  } catch {
    logger.warn('User-service unreachable for visibility check', {
      event: 'internal_api.user.unreachable',
      userId,
    })
    return null
  }
}

export async function invalidateUserVisibility(userId: string): Promise<void> {
  await cacheDel(`user:wc:${userId}`)
}

// ── Work center service calls ───────────────────────────────────────────────

interface WorkCenterInfo {
  type: 'physical' | 'virtual'
  productivityMode?: 'count_based' | 'speed_based'
}

export async function getWorkCenterInfo(workCenterId: string): Promise<WorkCenterInfo | null> {
  try {
    const res = await fetchInternal(WC_API, `/work-centers/${workCenterId}`)
    if (!res.ok) return null
    const body = (await res.json()) as { data?: WorkCenterInfo }
    return body.data ?? null
  } catch {
    logger.warn('Work-center-service unreachable', {
      event: 'internal_api.work_center.unreachable',
      workCenterId,
    })
    return null
  }
}
