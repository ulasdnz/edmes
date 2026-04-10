import type { Redis } from 'ioredis'

// biome-ignore lint: Handlers receive parsed JSON — callers narrow with their own types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventHandler = (data: any, type: string) => Promise<void>

export interface StreamConsumerConfig {
  /** Redis client dedicated to consuming (no keyPrefix). */
  redis: Redis
  /** Consumer group name — typically the service name (e.g. 'user-service'). */
  group: string
  /** Consumer name within the group — typically hostname or instance id. */
  consumer: string
  /** Map of stream → event type → handler. */
  streams: Record<string, Record<string, EventHandler>>
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    warn: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
  /** Wraps each event handler to seed context (e.g. AsyncLocalStorage with traceId). */
  runInContext?: (traceId: string, fn: () => Promise<void>) => Promise<void>
  /** Polling interval in ms when no messages are available. Default: 2000. */
  pollIntervalMs?: number
  /** Blocking read timeout for XREADGROUP in ms. Default: 0. Set 0 to disable blocking reads. */
  readBlockMs?: number
  /** Max messages to read per poll. Default: 10. */
  batchSize?: number
  /** Min idle time before abandoned pending messages are reclaimed. Default: 30000. */
  reclaimMinIdleMs?: number
  /** Max abandoned pending messages to reclaim per pass. Default: 50. */
  reclaimBatchSize?: number
  /** Dead-letter messages after this many deliveries. Default: 5. */
  maxDeliveries?: number
  /** Suffix appended to the source stream name for dead-lettered messages. Default: '.dlq'. */
  deadLetterSuffix?: string
  /** Max entries per stream before trimming. Default: 10000. */
  maxLen?: number
}
