import type { Job } from 'bullmq'
import {
  buildAuthContextCacheKey,
  buildAuthStatusCacheKey,
  type AuthCacheScope,
} from '@mes/auth'
import { cacheDel } from '../../lib/cache.js'
import { logger } from '../../lib/logger.js'

interface AuthCacheInvalidatePayload {
  userId: string
  scope: AuthCacheScope
}

const getKeysForScope = (userId: string, scope: AuthCacheScope): string[] => {
  if (scope === 'status') return [buildAuthStatusCacheKey(userId)]
  if (scope === 'context') return [buildAuthContextCacheKey(userId)]
  return [buildAuthStatusCacheKey(userId), buildAuthContextCacheKey(userId)]
}

export default async function authCacheInvalidateHandler(job: Job<AuthCacheInvalidatePayload>) {
  const { userId, scope } = job.data
  const keys = getKeysForScope(userId, scope)

  await Promise.all(keys.map(key => cacheDel(key)))

  logger.info(`Invalidated auth cache (${scope}) for user ${userId}`)
}
