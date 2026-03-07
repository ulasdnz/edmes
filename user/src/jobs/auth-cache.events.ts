import {
  buildAuthContextCacheKey,
  buildAuthStatusCacheKey,
  type AuthCacheScope,
} from '../lib/auth-cache-keys.js'
import { cacheDel } from '../lib/cache.js'
import { logger } from '../lib/logger.js'
import { authCacheEventsQueue } from './queues.js'

const buildKeysForScope = (userId: string, scope: AuthCacheScope): string[] => {
  if (scope === 'status') return [buildAuthStatusCacheKey(userId)]
  if (scope === 'context') return [buildAuthContextCacheKey(userId)]
  return [buildAuthStatusCacheKey(userId), buildAuthContextCacheKey(userId)]
}

const invalidateDirect = async (userId: string, scope: AuthCacheScope): Promise<void> => {
  const keys = buildKeysForScope(userId, scope)
  await Promise.all(keys.map(key => cacheDel(key)))
}

export const emitAuthCacheInvalidation = async (
  userId: string,
  scope: AuthCacheScope = 'all',
): Promise<void> => {
  try {
    await authCacheEventsQueue.add(
      'auth-cache.invalidate-user',
      { userId, scope },
      {
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    )
  } catch (error) {
    logger.warn('Failed to enqueue auth cache invalidation, falling back to direct invalidation', {
      userId,
      scope,
      error: error instanceof Error ? error.message : error,
    })
    await invalidateDirect(userId, scope)
  }
}

export const emitAuthCacheInvalidationMany = async (
  userIds: string[],
  scope: AuthCacheScope = 'all',
): Promise<void> => {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))]
  if (uniqueUserIds.length === 0) return

  try {
    await authCacheEventsQueue.addBulk(
      uniqueUserIds.map(userId => ({
        name: 'auth-cache.invalidate-user',
        data: { userId, scope },
        opts: {
          removeOnComplete: 200,
          removeOnFail: 200,
        },
      })),
    )
  } catch (error) {
    logger.warn(
      'Failed to enqueue bulk auth cache invalidation, falling back to direct invalidation',
      {
        count: uniqueUserIds.length,
        scope,
        error: error instanceof Error ? error.message : error,
      },
    )

    await Promise.all(uniqueUserIds.map(userId => invalidateDirect(userId, scope)))
  }
}
