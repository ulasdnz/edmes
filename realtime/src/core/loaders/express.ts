import { createErrorHandler } from '@mes/core'
import { createHealthRoutes, redisProbe } from '@mes/health'
import express from 'express'
import { config } from '../../config/index.js'
import { logger } from '../../lib/logger.js'
import { sharedClient } from '../../lib/redis.js'

const errorHandler = createErrorHandler({ logger, nodeEnv: config.NODE_ENV })

export const initExpress = async () => {
  const app = express()

  const healthRoutes = createHealthRoutes({
    // Not the stream client: its connection sits in the consumer's blocking XREADGROUP, and a ping
    // queued behind that read outlasts the probe's timeout, so the service would look down
    probes: [redisProbe(sharedClient)],
    logger,
  })

  app.use(healthRoutes)
  app.use(errorHandler)

  return app
}
