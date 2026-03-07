import type { Request, Response } from 'express'
import { logger } from '../../lib/logger.js'
import { isShuttingDown } from '../../lib/shutdown.js'
import { buildHealthResponse, checkMongoDB, checkRedis } from './health.service.js'
import type { HealthResponse, LivenessResponse, ReadinessResponse } from './health.types.js'

export async function getHealth(_req: Request, res: Response<HealthResponse>): Promise<void> {
  if (isShuttingDown) {
    res.status(503).json(buildHealthResponse('unhealthy'))
    return
  }

  const health = buildHealthResponse()

  const [mongoResult, redisResult] = await Promise.allSettled([checkMongoDB(), checkRedis()])

  if (mongoResult.status === 'rejected') {
    health.services.mongodb = 'unhealthy'
    health.status = 'unhealthy'

    logger.warn('Health check failed: MongoDB is unhealthy', {
      reason: mongoResult.reason?.message,
    })
  }

  if (redisResult.status === 'rejected') {
    health.services.redis = 'unhealthy'

    logger.warn('Health check: Redis is unhealthy (optional dependency)', {
      reason: redisResult.reason?.message,
    })
  }

  const statusCode = health.status === 'unhealthy' ? 503 : 200
  res.status(statusCode).json(health)
}

export async function getReadiness(_req: Request, res: Response<ReadinessResponse>): Promise<void> {
  if (isShuttingDown) {
    res.status(503).json({ ready: false })
    return
  }

  try {
    await checkMongoDB()
    res.status(200).json({ ready: true })
  } catch (error) {
    logger.warn('Readiness check failed', {
      reason: error instanceof Error ? error.message : error,
    })

    res.status(503).json({ ready: false })
  }
}

export function getLiveness(_req: Request, res: Response<LivenessResponse>): void {
  if (isShuttingDown) {
    res.status(503).json({ alive: false })
    return
  }

  res.status(200).json({ alive: true })
}
