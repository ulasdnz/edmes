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
import { rolePaths } from '../../modules/role/role.openapi.js'
import roleRoutes from '../../modules/role/role.routes.js'
import { specialityPaths } from '../../modules/speciality/speciality.openapi.js'
import specialityRoutes from '../../modules/speciality/speciality.routes.js'
import authRoutes from '../../modules/user/auth.routes.js'
import userInternalRoutes from '../../modules/user/user.internal.routes.js'
import { userPaths } from '../../modules/user/user.openapi.js'
import userRoutes from '../../modules/user/user.routes.js'
import { errorHandler } from '../middleware/error-handler.js'
import { contextMiddleware, setUserId } from '../middleware/request-context.js'
import { initI18n } from './i18n.js'

/**
 * Shared route modules — mounted on BOTH /api/v1 and /internal/v1.
 * The difference is the middleware chain, not the routes.
 */
const mountSharedRoutes = (router: ReturnType<typeof Router>) => {
  router.use(userRoutes)
  router.use(roleRoutes)
  router.use(specialityRoutes)
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
  app.use(express.static('public'))
  app.use('/uploads', express.static('uploads'))
  app.disable('x-powered-by')
  app.disable('etag')

  // ─── API Documentation ──────────────────────────────────────────────────────
  const combinedPaths = {
    ...userPaths,
    ...rolePaths,
    ...specialityPaths,
  }
  const openApiSpec = generateOpenApiDocument(combinedPaths)

  // Always expose the raw JSON schema for AI Agents (MCP) / FastMCP integrations
  app.get('/docs.json', (_req: Request, res: Response) => {
    res.json(openApiSpec)
  })

  // Only expose the human-readable Swagger HTML UI in non-production environments
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

  // ─── Public auth routes (no auth required) ──────────────────────────────────
  app.use('/api/v1', authRoutes)

  // ─── Protected API routes ───────────────────────────────────────────────────
  const apiRouter = Router()
  apiRouter.use(authenticate as express.RequestHandler)
  mountSharedRoutes(apiRouter)

  app.use('/api/v1', apiRouter)

  // ─── Internal routes (inter-service, token auth) ───────────────────────────
  // Same routes, but with system-level permissions bypass.
  // Gateway blocks external access to /internal/*
  const internalRouter = Router()
  internalRouter.use(requireInternalToken(config.INTERNAL_API_TOKEN))
  internalRouter.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: SYSTEM_IDENTITY, roles: [], permissions: ['*'], workCenterIds: [] }
    setUserId(SYSTEM_IDENTITY)
    next()
  })
  mountSharedRoutes(internalRouter)
  internalRouter.use(userInternalRoutes)

  app.use('/internal/v1', internalRouter)

  // ─── Error handler ─────────────────────────────────────────────────────────
  app.use(errorHandler)

  return app
}
