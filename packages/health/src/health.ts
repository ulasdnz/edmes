import { isShuttingDown } from '@mes/core'
import type { Request, Response } from 'express'
import { Router } from 'express'
import type {
  HealthConfig,
  HealthResponse,
  LivenessResponse,
  ReadinessResponse,
  ServiceStatus,
} from './types.js'

function buildHealthResponse(services: Record<string, ServiceStatus>): HealthResponse {
  const mem = process.memoryUsage()

  const overallStatus: ServiceStatus = Object.values(services).includes('unhealthy')
    ? 'unhealthy'
    : 'healthy'

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
    services,
  }
}

export function createHealthRoutes(config: HealthConfig): Router {
  const router = Router()
  const { probes, logger } = config

  router.get('/health', async (_req: Request, res: Response<HealthResponse>) => {
    if (isShuttingDown) {
      const services: Record<string, ServiceStatus> = {}
      for (const probe of probes) services[probe.name] = 'unhealthy'
      res.status(503).json(buildHealthResponse(services))
      return
    }

    const services: Record<string, ServiceStatus> = {}
    const results = await Promise.allSettled(probes.map(p => p.check()))

    for (let i = 0; i < probes.length; i++) {
      const probe = probes[i]
      const result = results[i]
      if (result.status === 'rejected') {
        services[probe.name] = 'unhealthy'
        logger.warn(`Health check failed: ${probe.name} is unhealthy`, {
          event: 'health.check.failed',
          probe: probe.name,
          reason: result.reason?.message,
        })
      } else {
        services[probe.name] = 'healthy'
      }
    }

    const response = buildHealthResponse(services)
    res.status(response.status === 'unhealthy' ? 503 : 200).json(response)
  })

  router.get('/health/ready', async (_req: Request, res: Response<ReadinessResponse>) => {
    if (isShuttingDown) {
      res.status(503).json({ ready: false })
      return
    }

    try {
      await Promise.all(probes.map(p => p.check()))
      res.status(200).json({ ready: true })
    } catch (error) {
      logger.warn('Readiness check failed', {
        event: 'health.readiness.failed',
        reason: error instanceof Error ? error.message : String(error),
      })
      res.status(503).json({ ready: false })
    }
  })

  router.get('/health/live', (_req: Request, res: Response<LivenessResponse>) => {
    if (isShuttingDown) {
      res.status(503).json({ alive: false })
      return
    }
    res.status(200).json({ alive: true })
  })

  return router
}
