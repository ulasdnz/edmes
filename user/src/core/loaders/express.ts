import compression from 'compression'
import cors from 'cors'
import type { NextFunction, Request, Response } from 'express'
import express, { json, Router, urlencoded } from 'express'
import helmet from 'helmet'

import { config } from '../../config/index.js'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import { morganMiddleware } from '../../lib/logger.js'
import { generateOpenApiDocument } from '../../lib/openapi/setup.js'
import healthRoutes from '../../modules/health/health.routes.js'
import { passwordRecoveryPaths } from '../../modules/password-recovery/password-recovery.openapi.js'
import passwordRecoveryRoutes from '../../modules/password-recovery/password-recovery.routes.js'
import { rolePaths } from '../../modules/role/role.openapi.js'
import roleRoutes from '../../modules/role/role.routes.js'
import { specialityPaths } from '../../modules/speciality/speciality.openapi.js'
import specialityRoutes from '../../modules/speciality/speciality.routes.js'
import authRoutes from '../../modules/user/auth.routes.js'
import { userPaths } from '../../modules/user/user.openapi.js'
import userRoutes from '../../modules/user/user.routes.js'
import { authenticate, resolvePermissions, configureAuth } from '@mes/auth'
import { errorHandler } from '../middleware/error-handler.js'
import { contextMiddleware, setUserId } from '../middleware/request-context.js'
import { initI18n } from './i18n.js'
import { cacheWrapDedup } from '../../lib/cache.js'

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
    cacheWrapDedup,
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
  app.use(morganMiddleware)
  app.use(express.static('public'))
  app.use('/uploads', express.static('uploads'))
  app.disable('x-powered-by')
  app.disable('etag')

  // ─── API Documentation ──────────────────────────────────────────────────────
  const combinedPaths = {
    ...userPaths,
    ...rolePaths,
    ...specialityPaths,
    ...passwordRecoveryPaths,
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
      // Gracefully handle the case where the app is run in a production Docker container
      // but NODE_ENV is overridden to development, meaning devDependencies are missing.
      console.warn('⚠️ Swagger UI is not available because swagger-ui-express is missing.')
    }
  }

  // ─── Health (no prefix, no auth) ────────────────────────────────────────────
  app.use(healthRoutes)

  // ─── Public auth routes (no auth required) ──────────────────────────────────
  app.use('/api/v1', authRoutes)
  app.use('/api/v1', passwordRecoveryRoutes)

  // ─── Protected API routes ───────────────────────────────────────────────────
  // authenticate → resolvePermissions → shared routes (with requirePermission)
  const apiRouter = Router()
  apiRouter.use(authenticate as express.RequestHandler)
  apiRouter.use(resolvePermissions as express.RequestHandler)
  mountSharedRoutes(apiRouter)

  app.use('/api/v1', apiRouter)

  // ─── Internal routes (inter-service, no auth) ──────────────────────────────
  // Same routes, but with system-level permissions bypass.
  // Gateway blocks external access to /internal/*
  const internalRouter = Router()
  internalRouter.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: SYSTEM_IDENTITY, roles: [], permissions: ['*'] }
    setUserId(SYSTEM_IDENTITY)
    next()
  })
  mountSharedRoutes(internalRouter)

  app.use('/internal/v1', internalRouter)

  // ─── Error handler ─────────────────────────────────────────────────────────
  app.use(errorHandler)

  return app
}
