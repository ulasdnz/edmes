import { INTERNAL_TOKEN_HEADER } from '@mes/auth'
import { CustomError, getTraceId } from '@mes/core'
import { config } from '../../config/index.js'
import { cacheDel, cacheWrapDedup } from '../cache.js'
import { logger } from '../logger.js'

export interface WorkCenterSnapshot {
  _id: string
  code?: string
  type: string
  productivityMode?: string
  status?: string
  tagBindings?: {
    runModeTagId?: string
    speedTagId?: string
    productionCounterTagId?: string
  }
  metricComposition?: unknown
}

const CACHE_TTL = 120

const cacheKey = (id: string) => `wc:${id}`

export async function getById(workCenterId: string): Promise<WorkCenterSnapshot | null> {
  return cacheWrapDedup<WorkCenterSnapshot | null>(cacheKey(workCenterId), CACHE_TTL, async () => {
    try {
      const res = await fetch(
        `${config.INTERNAL_API_WORK_CENTER}/internal/v1/work-centers/${workCenterId}`,
        {
          method: 'GET',
          headers: {
            'x-trace-id': getTraceId() ?? '',
            [INTERNAL_TOKEN_HEADER]: config.INTERNAL_API_TOKEN,
            accept: 'application/json',
          },
        },
      )
      if (res.status === 404) return null
      // Unreachable is not "no such work center"
      if (!res.ok) {
        logger.warn('Work center internal fetch failed', {
          event: 'internal_api.work_center.fetch_failed',
          status: res.status,
          workCenterId,
        })
        throw new CustomError(503, 'error.work_center_unreachable')
      }
      const body = (await res.json()) as { data?: WorkCenterSnapshot }
      return body.data ?? null
    } catch (err) {
      if (err instanceof CustomError) throw err
      logger.warn('Work center internal fetch errored', {
        event: 'internal_api.work_center.fetch_errored',
        workCenterId,
        error: err instanceof Error ? err.message : err,
      })
      throw new CustomError(503, 'error.work_center_unreachable')
    }
  })
}

export async function invalidate(workCenterId: string): Promise<void> {
  await cacheDel(cacheKey(workCenterId))
}
