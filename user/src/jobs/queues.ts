import { Queue } from 'bullmq'
import type { AuthCacheScope } from '@mes/auth'
import { getBullConnectionOpts } from '../lib/redis.js'

// ── Queues this service CONSUMES from ───────────────────────────────────────

/**
 * Cross-service event queue.
 * Other services ADD events (e.g., station.deleted) to this queue.
 * This service's workers PROCESS them.
 */
export const stationEventsQueue = new Queue('station-events', {
  connection: getBullConnectionOpts(),
})

export interface AuthCacheInvalidateEvent {
  userId: string
  scope: AuthCacheScope
}

/**
 * Local auth cache invalidation queue.
 * Producers publish user-specific invalidation events after mutations.
 */
export const authCacheEventsQueue = new Queue<AuthCacheInvalidateEvent>('auth-cache-events', {
  connection: getBullConnectionOpts(),
})
