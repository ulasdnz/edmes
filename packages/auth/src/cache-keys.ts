export type AuthCacheScope = 'status' | 'context' | 'all'

/**
 * Cache key for authentication status checks (isActivated / passwordChangedAt).
 * @deprecated Use buildAuthContextCacheKey for the consolidated auth context.
 */
export const buildAuthStatusCacheKey = (userId: string): string => `auth_status:${userId}`

/**
 * Cache key for the full consolidated auth context
 * (status + roles + permissions + workCenterIds).
 */
export const buildAuthContextCacheKey = (userId: string): string => `auth:ctx:${userId}`
