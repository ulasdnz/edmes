import { createErrorHandler } from '@mes/core'
import { createHealthRoutes, redisProbe } from '@mes/health'
import express from 'express'
import { config } from '../../config/index.js'
import { logger } from '../../lib/logger.js'
import { streamClient } from '../../lib/redis.js'

const errorHandler = createErrorHandler({ logger, nodeEnv: config.NODE_ENV })

export const initExpress = async () => {
  const app = express()

  const healthRoutes = createHealthRoutes({
    probes: [redisProbe(streamClient)],
    logger,
  })

  app.use(healthRoutes)
  app.use(errorHandler)

  return app
}
