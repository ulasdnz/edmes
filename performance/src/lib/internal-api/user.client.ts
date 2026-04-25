import { getTraceId } from '@mes/core'
import { config } from '../../config/index.js'
import { cacheDel, cacheWrapDedup } from '../cache.js'
import { logger } from '../logger.js'

const CACHE_TTL = 300

const cacheKey = (userId: string) => `userWorkCenterIds:${userId}`

export async function getUserWorkCenterIds(userId: string): Promise<string[]> {
  return cacheWrapDedup<string[]>(cacheKey(userId), CACHE_TTL, async () => {
    try {
      const res = await fetch(
        `${config.INTERNAL_API_USER}/internal/v1/users/${userId}/work-center-ids`,
        {
          method: 'GET',
          headers: {
            'x-trace-id': getTraceId() ?? '',
            accept: 'application/json',
          },
        },
      )
      if (res.status === 404) return []
      if (!res.ok) {
        logger.warn('User work center ids fetch failed', {
          event: 'internal_api.user.work_center_ids.fetch_failed',
          status: res.status,
          userId,
        })
        return []
      }
      const body = (await res.json()) as { data?: string[] }
      return body.data ?? []
    } catch (err) {
      logger.warn('User work center ids fetch errored', {
        event: 'internal_api.user.work_center_ids.fetch_errored',
        userId,
        error: err instanceof Error ? err.message : err,
      })
      return []
    }
  })
}

export async function invalidateUserWorkCenterIds(userId: string): Promise<void> {
  await cacheDel(cacheKey(userId))
}
