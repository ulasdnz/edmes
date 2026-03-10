import { type AuthCacheScope, buildAuthContextCacheKey, buildAuthStatusCacheKey } from '@mes/auth'
import { cacheDel } from '../lib/cache.js'

const buildKeysForScope = (userId: string, scope: AuthCacheScope): string[] => {
  if (scope === 'status') return [buildAuthStatusCacheKey(userId)]
  if (scope === 'context') return [buildAuthContextCacheKey(userId)]
  return [buildAuthStatusCacheKey(userId), buildAuthContextCacheKey(userId)]
}

export const invalidateAuthCache = async (
  userId: string,
  scope: AuthCacheScope = 'all',
): Promise<void> => {
  const keys = buildKeysForScope(userId, scope)
  await Promise.all(keys.map(key => cacheDel(key)))
}

export const invalidateAuthCacheMany = async (
  userIds: string[],
  scope: AuthCacheScope = 'all',
): Promise<void> => {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))]
  if (uniqueUserIds.length === 0) return

  await Promise.all(uniqueUserIds.map(userId => invalidateAuthCache(userId, scope)))
}
