/**
 * Cache key for the full consolidated auth context
 * (status + roles + permissions + workCenterIds).
 */
export const buildAuthContextCacheKey = (userId: string): string => `auth:ctx:${userId}`
