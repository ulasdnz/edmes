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
import { generateOpenApiDocument } from '../../lib/openapi/setup.js'
import { redisClient } from '../../lib/redis.js'
import workCenterReferencesRoutes from '../../modules/internal/work-center-references.routes.js'
import jobOrderRoutes from '../../modules/job-order/job-order.routes.js'
import productRoutes from '../../modules/product/product.routes.js'
import productCategoryRoutes from '../../modules/product-category/product-category.routes.js'
import productStandardRoutes from '../../modules/product-standard/product-standard.routes.js'
import productionPlanRoutes from '../../modules/production-plan/production-plan.routes.js'
import quantityAdjustmentRoutes from '../../modules/quantity-adjustment/quantity-adjustment.routes.js'
import scrapEntryRoutes from '../../modules/scrap-entry/scrap-entry.routes.js'
import uomRoutes from '../../modules/uom/uom.routes.js'
import { errorHandler } from '../middleware/error-handler.js'
import { contextMiddleware, setUserId } from '../middleware/request-context.js'
import { initI18n } from './i18n.js'

/**
 * Shared route modules — mounted on BOTH /api/v1 and /internal/v1.
 * The difference is the middleware chain, not the routes.
 */
const mountSharedRoutes = (router: ReturnType<typeof Router>) => {
  router.use(uomRoutes)
  router.use(productCategoryRoutes)
  router.use(productRoutes)
  router.use(productStandardRoutes)
  router.use(productionPlanRoutes)
  router.use(jobOrderRoutes)
  router.use(quantityAdjustmentRoutes)
  router.use(scrapEntryRoutes)
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
    } catch (error) {
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

  app.use('/api/v1', apiRouter)

  // ─── Internal routes (inter-service, no auth) ──────────────────────────────
  const internalRouter = Router()
  internalRouter.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: SYSTEM_IDENTITY, roles: [], permissions: ['*'], workCenterIds: [] }
    setUserId(SYSTEM_IDENTITY)
    next()
  })
  mountSharedRoutes(internalRouter)
  internalRouter.use(workCenterReferencesRoutes)

  app.use('/internal/v1', internalRouter)

  // ─── Error handler ─────────────────────────────────────────────────────────
  app.use(errorHandler)

  return app
}
