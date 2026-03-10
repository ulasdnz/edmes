import type { Redis } from 'ioredis'

const DEFAULT_MAX_LEN = 10000

/**
 * Publish an event to a Redis Stream.
 *
 * @param redis  - Redis client (must NOT have a keyPrefix).
 * @param stream - Stream name, e.g. 'events.user'.
 * @param type   - Event type, e.g. 'user.created'.
 * @param data   - Arbitrary payload. Serialised as JSON.
 * @param maxLen - Approximate max stream length for trimming. Default 10 000.
 * @returns The message ID assigned by Redis.
 */
export async function publishEvent(
  redis: Redis,
  stream: string,
  type: string,
  data: Record<string, unknown>,
  maxLen = DEFAULT_MAX_LEN,
): Promise<string | null> {
  return redis.xadd(
    stream,
    'MAXLEN',
    '~',
    String(maxLen),
    '*',
    'type',
    type,
    'data',
    JSON.stringify(data),
    'timestamp',
    new Date().toISOString(),
  )
}
