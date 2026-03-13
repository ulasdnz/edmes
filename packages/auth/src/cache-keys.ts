export type AuthCacheScope = 'status' | 'context' | 'all'

/**
 * Cache key for authentication status checks (isActivated / passwordChangedAt).
 */
export const buildAuthStatusCacheKey = (userId: string): string => `auth_status:${userId}`

/**
 * Cache key for resolved roles/permissions context.
 */
export const buildAuthContextCacheKey = (userId: string): string => `auth_context:${userId}`
