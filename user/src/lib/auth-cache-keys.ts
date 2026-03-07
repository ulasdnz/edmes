export type AuthCacheScope = 'status' | 'context' | 'all'

/**
 * Keep these key builders aligned with @mes/auth package.
 * Redis keyPrefix ('user:') is applied by ioredis client config.
 */
export const buildAuthStatusCacheKey = (userId: string): string => `auth_status:${userId}`
export const buildAuthContextCacheKey = (userId: string): string => `auth_context:${userId}`

