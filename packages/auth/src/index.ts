export { configureAuth, getAuthConfig, type AuthMiddlewareConfig } from './config.js'
export {
  buildAuthContextCacheKey,
  buildAuthStatusCacheKey,
  type AuthCacheScope,
} from './cache-keys.js'
export { AuthError } from './error.js'
export { authenticate } from './authenticate.js'
export { resolvePermissions } from './resolve-permissions.js'
export { requirePermission } from './authorize.js'
