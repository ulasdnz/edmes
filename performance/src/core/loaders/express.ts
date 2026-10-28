import { authenticate, configureAuth, requireInternalToken } from '@mes/auth'
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
import { generateOpenApiDocument } from '../../lib/openapi/setup.js'
import { redisClient } from '../../lib/redis.js'
import oeeRoutes from '../../modules/oee/oee.routes.js'
import plannedStopRoutes from '../../modules/planned-stop/planned-stop.routes.js'
import plannedStopScheduleRoutes from '../../modules/planned-stop-schedule/planned-stop-schedule.routes.js'
import plannedStopTemplateRoutes from '../../modules/planned-stop-template/planned-stop-template.routes.js'
import policyRoutes from '../../modules/policy/policy.routes.js'
import reasonRoutes from '../../modules/reason/reason.routes.js'
import unplannedStopRoutes from '../../modules/unplanned-stop/unplanned-stop.routes.js'
import { errorHandler } from '../middleware/error-handler.js'
import { contextMiddleware, setUserId } from '../middleware/request-context.js'
import { initI18n } from './i18n.js'

const mountSharedRoutes = (router: ReturnType<typeof Router>) => {
  router.use(reasonRoutes)
  router.use(policyRoutes)
  router.use(plannedStopRoutes)
  router.use(plannedStopTemplateRoutes)
  router.use(plannedStopScheduleRoutes)
  router.use(unplannedStopRoutes)
}

export const initExpress = async () => {
  const app = express()

  configureAuth({
    jwtSecret: config.JWT_SECRET,
    userServiceInternalUrl: config.INTERNAL_API_USER,
    internalApiToken: config.INTERNAL_API_TOKEN,
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

  // ─── API Documentation ──────────────────────────────────────────────────────
  const combinedPaths = {}
  const openApiSpec = generateOpenApiDocument(combinedPaths)

  app.get('/docs.json', (_req: Request, res: Response) => {
    res.json(openApiSpec)
  })

  if (config.NODE_ENV !== 'production') {
    try {
      const { default: swaggerUi } = await import('swagger-ui-express')
      app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec))
    } catch (_error) {
      logger.debug('Swagger UI not available — swagger-ui-express is not installed', {
        event: 'server.swagger.unavailable',
      })
    }
  }

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
  apiRouter.use(oeeRoutes)

  app.use('/api/v1', apiRouter)

  // ─── Internal routes (inter-service, token auth) ───────────────────────────
  const internalRouter = Router()
  internalRouter.use(requireInternalToken(config.INTERNAL_API_TOKEN))
  internalRouter.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: SYSTEM_IDENTITY, roles: [], permissions: ['*'], workCenterIds: [] }
    setUserId(SYSTEM_IDENTITY)
    next()
  })
  mountSharedRoutes(internalRouter)

  app.use('/internal/v1', internalRouter)

  // ─── Error handler ─────────────────────────────────────────────────────────
  app.use(errorHandler)

  return app
}
