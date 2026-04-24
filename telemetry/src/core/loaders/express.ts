import { authenticate, configureAuth } from '@mes/auth'
import { createHealthRoutes, mongoProbe, redisProbe } from '@mes/health'
import compression from 'compression'
import cors from 'cors'
import type { NextFunction, Request, Response } from 'express'
import express, { json, Router, urlencoded } from 'express'
import helmet from 'helmet'
import mongoose from 'mongoose'
import { config } from '../../config/index.js'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import { sharedCacheWrapDedup } from '../../lib/cache.js'
import { httpLoggerMiddleware, logger, morganMiddleware } from '../../lib/logger.js'
import { redisClient } from '../../lib/redis.js'
import discoveryRoutes from '../../modules/discovery/discovery.routes.js'
import edgeDeviceRoutes from '../../modules/edge-device/edge-device.routes.js'
import historianInternalRoutes from '../../modules/historian/historian.internal.routes.js'
import historianRoutes from '../../modules/historian/historian.routes.js'
import tagRoutes from '../../modules/tag/tag.routes.js'
import tagTypeRoutes from '../../modules/tag-type/tag-type.routes.js'
import { errorHandler } from '../middleware/error-handler.js'
import { contextMiddleware, setUserId } from '../middleware/request-context.js'
import { initI18n } from './i18n.js'

const mountSharedRoutes = (router: ReturnType<typeof Router>) => {
  router.use(tagTypeRoutes)
  router.use(edgeDeviceRoutes)
  router.use(tagRoutes)
  router.use(historianRoutes)
  router.use(discoveryRoutes)
}

export const initExpress = async () => {
  const app = express()

  configureAuth({
    jwtSecret: config.JWT_SECRET,
    userServiceInternalUrl: config.INTERNAL_API_USER,
    cacheWrapDedup: sharedCacheWrapDedup,
  })

  const i18nMiddleware = await initI18n()

  app.enable('trust proxy')
  app.use(helmet())
  app.use(cors())
  app.use(json())
  app.use(urlencoded({ extended: true }))
  app.use(compression())
  app.use(i18nMiddleware)

  app.use(contextMiddleware)
  app.use(config.NODE_ENV === 'production' ? httpLoggerMiddleware : morganMiddleware)
  app.disable('x-powered-by')
  app.disable('etag')

  // ─── Health (no prefix, no auth) ────────────────────────────────────────────
  const healthRoutes = createHealthRoutes({
    probes: [mongoProbe(mongoose), redisProbe(redisClient)],
    logger,
  })
  app.use(healthRoutes)

  // ─── Protected API routes ───────────────────────────────────────────────────
  const apiRouter = Router()
  apiRouter.use(authenticate as express.RequestHandler)
  mountSharedRoutes(apiRouter)

  app.use('/api/v1', apiRouter)

  // ─── Internal routes (inter-service, no auth) ──────────────────────────────
  const internalRouter = Router()
  internalRouter.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: SYSTEM_IDENTITY, roles: [], permissions: ['*'], workCenterIds: [] }
    setUserId(SYSTEM_IDENTITY)
    next()
  })
  mountSharedRoutes(internalRouter)
  internalRouter.use(historianInternalRoutes)

  app.use('/internal/v1', internalRouter)

  // ─── Error handler ─────────────────────────────────────────────────────────
  app.use(errorHandler)

  return app
}
