import '../../test/contract-setup.js'

import { publishEvent } from '@mes/events'
import type { Redis } from 'ioredis'
import { describe, expect, it } from 'vitest'
import { testStreamRedis } from '../../test/contract-setup.js'

// ── helper ─────────────────────────────────────────────────────────────────────

type StreamEntry = { type: string; data: Record<string, unknown>; timestamp: string }

async function readNextFromStream(
  redis: Redis,
  stream: string,
  after: string,
  timeoutMs = 3000,
): Promise<StreamEntry | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const results = await redis.xread('COUNT', 10, 'STREAMS', stream, after)
    if (results && results.length > 0) {
      const [, entries] = results[0]
      if (entries.length > 0) {
        const [, fields] = entries[0]
        const raw: Record<string, string> = {}
        for (let i = 0; i < fields.length; i += 2) {
          raw[fields[i]] = fields[i + 1]
        }
        return {
          type: raw.type ?? '',
          data: raw.data ? (JSON.parse(raw.data) as Record<string, unknown>) : {},
          timestamp: raw.timestamp ?? '',
        }
      }
    }
    await new Promise(r => setTimeout(r, 50))
  }
  return null
}

const STREAM = 'events.performance'

async function getLastId(redis: Redis, stream: string): Promise<string> {
  try {
    const info = await redis.xinfo('STREAM', stream)
    const arr = info as string[]
    const idx = arr.indexOf('last-generated-id')
    if (idx !== -1) return arr[idx + 1]
  } catch {
    // stream doesn't exist yet
  }
  return '0-0'
}

describe('events.performance — publishEvent shape', () => {
  it('planned_stop.created event carries workCenterId in payload', async () => {
    const wcId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
    const plannedStopId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
    const before = await getLastId(testStreamRedis, STREAM)

    await publishEvent(testStreamRedis, STREAM, 'planned_stop.created', {
      plannedStopId,
      workCenterId: wcId,
      traceId: '',
    })

    const entry = await readNextFromStream(testStreamRedis, STREAM, before)
    expect(entry).not.toBeNull()
    expect(entry!.type).toBe('planned_stop.created')
    expect(entry!.data.plannedStopId).toBe(plannedStopId)
    expect(entry!.data.workCenterId).toBe(wcId)
  })

  it('planned_stop.closed event carries workCenterId in payload', async () => {
    const wcId = 'cccccccccccccccccccccccc'
    const plannedStopId = 'dddddddddddddddddddddddd'
    const before = await getLastId(testStreamRedis, STREAM)

    await publishEvent(testStreamRedis, STREAM, 'planned_stop.closed', {
      plannedStopId,
      workCenterId: wcId,
      traceId: '',
    })

    const entry = await readNextFromStream(testStreamRedis, STREAM, before)
    expect(entry).not.toBeNull()
    expect(entry!.type).toBe('planned_stop.closed')
    expect(entry!.data.workCenterId).toBe(wcId)
  })

  it('unplanned_stop.opened event carries workCenterId in payload', async () => {
    const wcId = 'eeeeeeeeeeeeeeeeeeeeeeee'
    const unplannedStopId = 'ffffffffffffffffffffff01'
    const before = await getLastId(testStreamRedis, STREAM)

    await publishEvent(testStreamRedis, STREAM, 'unplanned_stop.opened', {
      unplannedStopId,
      workCenterId: wcId,
      traceId: '',
    })

    const entry = await readNextFromStream(testStreamRedis, STREAM, before)
    expect(entry).not.toBeNull()
    expect(entry!.type).toBe('unplanned_stop.opened')
    expect(entry!.data.workCenterId).toBe(wcId)
  })

  it('unplanned_stop.closed event carries workCenterId in payload', async () => {
    const wcId = 'eeeeeeeeeeeeeeeeeeeeeeee'
    const unplannedStopId = 'ffffffffffffffffffffffff'
    const before = await getLastId(testStreamRedis, STREAM)

    await publishEvent(testStreamRedis, STREAM, 'unplanned_stop.closed', {
      unplannedStopId,
      workCenterId: wcId,
      traceId: '',
    })

    const entry = await readNextFromStream(testStreamRedis, STREAM, before)
    expect(entry).not.toBeNull()
    expect(entry!.type).toBe('unplanned_stop.closed')
    expect(entry!.data.workCenterId).toBe(wcId)
  })

  it('all events have a traceId field in the parsed data', async () => {
    const before = await getLastId(testStreamRedis, STREAM)

    await publishEvent(testStreamRedis, STREAM, 'reason.created', {
      reasonId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      traceId: 'test-trace-123',
    })

    const entry = await readNextFromStream(testStreamRedis, STREAM, before)
    expect(entry).not.toBeNull()
    expect(entry!.data.traceId).toBe('test-trace-123')
  })
})
