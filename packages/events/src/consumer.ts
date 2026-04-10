import { publishEvent } from './publish.js'
import type { StreamConsumerConfig } from './types.js'

/** Shape returned by ioredis xreadgroup: [streamName, [[messageId, [field, value, ...]], ...]] */
type XReadGroupResult = [stream: string, messages: [id: string, fields: string[]][]][]
type StreamMessage = [id: string, fields: string[]]
type XAutoClaimResult = [nextStartId: string, messages: StreamMessage[], deletedIds?: string[]]
type XPendingDetailResult = [id: string, consumer: string, idleMs: number, deliveries: number][]

/**
 * Creates a Redis Stream consumer that reads messages from Redis Streams
 * using XREADGROUP, routes them to handlers, and ACKs on success.
 *
 * Uses non-blocking reads by default so the same Redis connection can still
 * be shared with publishing in services that do both. Services can opt into
 * bounded blocking reads explicitly.
 */
export function createStreamConsumer(config: StreamConsumerConfig) {
  const {
    redis,
    group,
    consumer,
    streams,
    logger,
    runInContext,
    pollIntervalMs = 2000,
    readBlockMs = 0,
    batchSize = 10,
    reclaimMinIdleMs = 30000,
    reclaimBatchSize = 50,
    maxDeliveries = 5,
    deadLetterSuffix = '.dlq',
  } = config

  let stopped = false
  let runPromise: Promise<void> | null = null
  const streamNames = Object.keys(streams)

  /** Ensure consumer groups exist for every stream (idempotent). */
  async function ensureGroups(): Promise<void> {
    for (const stream of streamNames) {
      try {
        await redis.xgroup('CREATE', stream, group, '$', 'MKSTREAM')
      } catch (err: unknown) {
        // BUSYGROUP = group already exists — safe to ignore.
        if (err instanceof Error && err.message.includes('BUSYGROUP')) continue
        throw err
      }
    }
  }

  /** Parse the flat field array from XREADGROUP into a keyed object. */
  function parseFields(fields: string[]): Record<string, string> {
    const obj: Record<string, string> = {}
    for (let i = 0; i < fields.length; i += 2) {
      obj[fields[i]] = fields[i + 1]
    }
    return obj
  }

  /** Process a batch of messages from one stream. */
  async function processBatch(stream: string, messages: [string, string[]][]): Promise<void> {
    const handlers = streams[stream]

    for (const [id, fields] of messages) {
      const parsed = parseFields(fields)
      const handler = handlers[parsed.type] ?? handlers['*']

      if (!handler) {
        logger.warn(`No handler for event type "${parsed.type}" on stream "${stream}", skipping`, {
          event: 'events.handler.not_found',
          eventType: parsed.type,
          stream,
        })
        await redis.xack(stream, group, id)
        continue
      }

      let data: Record<string, unknown> | undefined

      try {
        data = JSON.parse(parsed.data ?? '{}') as Record<string, unknown>
        const traceId = typeof data.traceId === 'string' ? data.traceId : id

        const execute = () => handler(data, parsed.type)
        await (runInContext ? runInContext(traceId, execute) : execute())

        await redis.xack(stream, group, id)
      } catch (err) {
        const deliveries = await getDeliveryCount(stream, id)

        if (deliveries !== null && deliveries >= maxDeliveries) {
          await deadLetterAndAck({
            stream,
            id,
            type: parsed.type,
            data,
            rawData: parsed.data,
            error: err,
            deliveries,
          })
          continue
        }

        logger.error(`Failed to process event ${id} (${parsed.type}) on ${stream}`, {
          event: 'events.handler.failed',
          eventId: id,
          eventType: parsed.type,
          stream,
          deliveries,
          error: err instanceof Error ? err.message : err,
        })
        // Don't ACK — message stays pending and can be retried.
      }
    }
  }

  async function getDeliveryCount(stream: string, id: string): Promise<number | null> {
    try {
      const result = (await redis.xpending(stream, group, id, id, 1)) as XPendingDetailResult | null
      if (!Array.isArray(result) || result.length === 0) return null

      const deliveries = Number(result[0][3])
      return Number.isFinite(deliveries) ? deliveries : null
    } catch (err) {
      logger.error(`Failed to inspect delivery count for event ${id} on ${stream}`, {
        event: 'events.pending.inspect_failed',
        eventId: id,
        stream,
        error: err instanceof Error ? err.message : err,
      })
      return null
    }
  }

  async function deadLetterAndAck(params: {
    stream: string
    id: string
    type: string
    data?: Record<string, unknown>
    rawData?: string
    error: unknown
    deliveries: number
  }): Promise<void> {
    const { stream, id, type, data, rawData, error, deliveries } = params
    const deadLetterStream = `${stream}${deadLetterSuffix}`
    const errorMessage = error instanceof Error ? error.message : String(error)

    try {
      await publishEvent(redis, deadLetterStream, type, {
        originalStream: stream,
        originalId: id,
        data: data ?? null,
        rawData: rawData ?? null,
        failedAt: new Date().toISOString(),
        error: errorMessage,
        deliveries,
        consumer,
      })

      await redis.xack(stream, group, id)

      logger.error(`Dead-lettered event ${id} (${type}) from ${stream}`, {
        event: 'events.handler.dead_lettered',
        eventId: id,
        eventType: type,
        stream,
        deadLetterStream,
        deliveries,
        error: errorMessage,
      })
    } catch (deadLetterError) {
      logger.error(`Failed to dead-letter event ${id} (${type}) from ${stream}`, {
        event: 'events.handler.dead_letter_failed',
        eventId: id,
        eventType: type,
        stream,
        deadLetterStream,
        deliveries,
        error: deadLetterError instanceof Error ? deadLetterError.message : deadLetterError,
      })
    }
  }

  /** Read and process pending messages (from a previous crash). */
  async function recoverAbandonedPending(): Promise<void> {
    for (const stream of streamNames) {
      let start = '0-0'

      while (!stopped) {
        const result = (await redis.xautoclaim(
          stream,
          group,
          consumer,
          reclaimMinIdleMs,
          start,
          'COUNT',
          reclaimBatchSize,
        )) as XAutoClaimResult | null

        if (!result) break

        const [nextStartId, messages] = result
        if (messages.length === 0) break

        logger.warn(`Claimed ${messages.length} abandoned pending events on ${stream}`, {
          event: 'events.pending.claimed',
          count: messages.length,
          stream,
          consumer,
          minIdleMs: reclaimMinIdleMs,
        })

        await processBatch(stream, messages)

        if (nextStartId === start) break
        start = nextStartId
      }
    }
  }

  /** Read and process pending messages already owned by this consumer. */
  async function processPending(): Promise<void> {
    const ids = streamNames.map(() => '0')
    const results = (await redis.xreadgroup(
      'GROUP',
      group,
      consumer,
      'COUNT',
      String(batchSize),
      'STREAMS',
      ...streamNames,
      ...ids,
    )) as XReadGroupResult | null
    if (!results) return

    for (const [stream, messages] of results) {
      if (messages.length > 0) {
        logger.info(`Reprocessing ${messages.length} pending events on ${stream}`, {
          event: 'events.pending.reprocessing',
          count: messages.length,
          stream,
        })
        await processBatch(stream, messages)
      }
    }
  }

  /** Main poll loop — read new messages with '>' cursor. */
  async function pollLoop(): Promise<void> {
    const ids = streamNames.map(() => '>')

    while (!stopped) {
      try {
        const readArgs: Array<string> = ['GROUP', group, consumer, 'COUNT', String(batchSize)]
        if (readBlockMs > 0) {
          readArgs.push('BLOCK', String(readBlockMs))
        }
        readArgs.push('STREAMS', ...streamNames, ...ids)

        const xreadgroup = redis.xreadgroup.bind(redis) as (...args: string[]) => Promise<unknown>
        const results = (await xreadgroup(...readArgs)) as XReadGroupResult | null

        if (results) {
          for (const [stream, messages] of results) {
            await processBatch(stream, messages)
          }
        } else if (readBlockMs <= 0) {
          // No messages — sleep before next poll.
          await new Promise(r => setTimeout(r, pollIntervalMs))
        }
      } catch (err) {
        if (stopped) break
        logger.error('Stream consumer poll error', {
          event: 'events.consumer.poll_error',
          error: err instanceof Error ? err.message : err,
        })
        await new Promise(r => setTimeout(r, pollIntervalMs))
      }
    }
  }

  return {
    /** Start consuming. Resolves once the poll loop exits (after stop()). */
    async start(): Promise<void> {
      if (runPromise) return runPromise

      stopped = false
      runPromise = (async () => {
        await ensureGroups()
        await recoverAbandonedPending()
        await processPending()
        logger.info(
          `Stream consumer started [group=${group}] streams=[${streamNames.join(', ')}]`,
          {
            event: 'events.consumer.started',
            group,
            streams: streamNames,
          },
        )
        await pollLoop()
      })()

      try {
        await runPromise
      } finally {
        runPromise = null
      }
    },

    /** Signal the consumer to stop after the current batch completes and wait for drain. */
    async stop(): Promise<void> {
      stopped = true
      await runPromise
    },
  }
}
