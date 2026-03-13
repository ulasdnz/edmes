import type { StreamConsumerConfig } from './types.js'

/** Shape returned by ioredis xreadgroup: [streamName, [[messageId, [field, value, ...]], ...]] */
type XReadGroupResult = [stream: string, messages: [id: string, fields: string[]][]][]

/**
 * Creates a Redis Stream consumer that polls for messages
 * using XREADGROUP, routes them to handlers, and ACKs on success.
 *
 * Uses non-blocking reads + poll interval so a single Redis connection
 * can be shared with publishEvent().
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
    batchSize = 10,
  } = config

  let stopped = false
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
      const handler = handlers[parsed.type]

      if (!handler) {
        logger.warn(`No handler for event type "${parsed.type}" on stream "${stream}", skipping`, {
          event: 'events.handler.not_found',
          eventType: parsed.type,
          stream,
        })
        await redis.xack(stream, group, id)
        continue
      }

      try {
        const data = JSON.parse(parsed.data ?? '{}')
        const traceId: string = data.traceId ?? id

        const execute = () => handler(data)
        await (runInContext ? runInContext(traceId, execute) : execute())

        await redis.xack(stream, group, id)
      } catch (err) {
        logger.error(`Failed to process event ${id} (${parsed.type}) on ${stream}`, {
          event: 'events.handler.failed',
          eventId: id,
          eventType: parsed.type,
          stream,
          error: err instanceof Error ? err.message : err,
        })
        // Don't ACK — message stays pending and can be retried.
      }
    }
  }

  /** Read and process pending messages (from a previous crash). */
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

        if (results) {
          for (const [stream, messages] of results) {
            await processBatch(stream, messages)
          }
        } else {
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
      await ensureGroups()
      await processPending()
      logger.info(`Stream consumer started [group=${group}] streams=[${streamNames.join(', ')}]`, {
        event: 'events.consumer.started',
        group,
        streams: streamNames,
      })
      await pollLoop()
    },

    /** Signal the consumer to stop after the current poll completes. */
    stop(): void {
      stopped = true
    },
  }
}
