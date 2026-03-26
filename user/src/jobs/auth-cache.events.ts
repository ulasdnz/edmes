import { buildAuthContextCacheKey } from '@mes/auth'
import { sharedCacheDel } from '../lib/cache.js'

export const invalidateAuthCache = async (userId: string): Promise<void> => {
  await sharedCacheDel(buildAuthContextCacheKey(userId))
}

export const invalidateAuthCacheMany = async (userIds: string[]): Promise<void> => {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))]
  if (uniqueUserIds.length === 0) return

  await Promise.all(uniqueUserIds.map(userId => invalidateAuthCache(userId)))
}
