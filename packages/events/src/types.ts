import type { Redis } from 'ioredis'

// biome-ignore lint: Handlers receive parsed JSON — callers narrow with their own types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventHandler = (data: any) => Promise<void>

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
    info: (msg: string, ...args: unknown[]) => void
    warn: (msg: string, ...args: unknown[]) => void
    error: (msg: string, ...args: unknown[]) => void
  }
  /** Polling interval in ms when no messages are available. Default: 2000. */
  pollIntervalMs?: number
  /** Max messages to read per poll. Default: 10. */
  batchSize?: number
  /** Max entries per stream before trimming. Default: 10000. */
  maxLen?: number
}
