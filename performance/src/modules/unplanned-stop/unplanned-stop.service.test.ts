import { profileOperations } from '@mes/testing'
import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Events and the cache go to Redis, so a real one runs. Performance builds its Redis clients from
// REDIS_URL when their module loads, so Redis starts before the imports below run.
const { redis } = await vi.hoisted(async () => {
  const { startRedisTestContainer } = await import('@mes/testing')
  const redis = await startRedisTestContainer()
  process.env.REDIS_URL = redis.url
  return { redis }
})

import * as events from '../../jobs/events.js'
import { closeRedis, initRedis, redisClient } from '../../lib/redis.js'
import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import * as policyService from '../policy/policy.service.js'
import { bootstrapSystemReasons, MICRO_STOP_CODE } from '../reason/reason.bootstrap.js'
import { Reason, type ReasonUsage } from '../reason/reason.model.js'
import { UnplannedStop } from './unplanned-stop.model.js'
import * as service from './unplanned-stop.service.js'
import { patchUnplannedStopSchema } from './unplanned-stop.validators.js'

const userId = new Types.ObjectId().toString()

beforeAll(async () => {
  await initRedis()
})

afterAll(async () => {
  await closeRedis()
  await redis.stop()
})

// The database is emptied after every test, so the cache is too
beforeEach(async () => {
  await redisClient.flushall()
})

async function seedReason(
  overrides: Partial<{
    code: string
    name: string
    usages: ReasonUsage[]
    canConvertFromUnplanned: boolean
    isActive: boolean
    affectsOee: boolean
  }> = {},
) {
  const reason = await Reason.create({
    code: overrides.code ?? `R-${new Types.ObjectId().toString()}`,
    name: overrides.name ?? 'Manual Reason',
    usages: overrides.usages ?? ['unplanned_stop'],
    canStartManually: false,
    canBeScheduled: false,
    canConvertFromUnplanned: overrides.canConvertFromUnplanned ?? true,
    isSystemDefault: false,
    isActive: overrides.isActive ?? true,
    affectsOee: overrides.affectsOee ?? true,
    createdBy: new Types.ObjectId(userId),
  })
  return reason
}

function watchStopEvents() {
  return {
    opened: vi.spyOn(events, 'emitUnplannedStopOpened'),
    closed: vi.spyOn(events, 'emitUnplannedStopClosed'),
    updated: vi.spyOn(events, 'emitUnplannedStopUpdated'),
  }
}

async function microStopReasonId(): Promise<string> {
  const reason = await Reason.findOne({ code: MICRO_STOP_CODE, isSystemDefault: true }).lean()
  if (!reason) throw new Error('MICRO_STOP reason was not bootstrapped')
  return reason._id.toString()
}

function stopsOf(workCenterId: string) {
  return UnplannedStop.find({ workCenterId: new Types.ObjectId(workCenterId) }).lean()
}

describe('UnplannedStopService', () => {
  beforeEach(async () => {
    await bootstrapSystemReasons()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('openFromRunMode', () => {
    it('creates a new open stop when none exists', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      const doc = await service.openFromRunMode(wcId, startAt)
      expect(doc.workCenterId.toString()).toBe(wcId)
      expect(doc.source).toBe('run_mode')
      expect(doc.startAt.toISOString()).toBe(startAt.toISOString())
      expect(doc.endAt).toBeNull()
    })

    it('is idempotent — returns existing open stop on duplicate-key race', async () => {
      const wcId = new Types.ObjectId().toString()
      const first = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'))
      const second = await service.openFromRunMode(wcId, new Date('2026-06-15T10:05:00.000Z'))
      expect(second._id.toString()).toBe(first._id.toString())
      const count = await UnplannedStop.countDocuments({
        workCenterId: new Types.ObjectId(wcId),
      })
      expect(count).toBe(1)
    })

    it('returns the recorded stop when a run-mode stop with the same start is opened again', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      const recorded = await service.recordClosedFromRunMode(
        wcId,
        startAt,
        new Date('2026-06-15T10:05:00.000Z'),
      )
      const stopEvents = watchStopEvents()

      const again = await service.openFromRunMode(wcId, startAt)

      expect(again._id.toString()).toBe(recorded._id.toString())
      expect(again.endAt?.toISOString()).toBe('2026-06-15T10:05:00.000Z')
      expect(await stopsOf(wcId)).toHaveLength(1)
      expect(stopEvents.opened).not.toHaveBeenCalled()
    })
  })

  describe('recordClosedFromRunMode', () => {
    it('inserts the stop already closed and publishes the opened event, then the closed event', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      const endAt = new Date('2026-06-15T10:05:00.000Z')
      const stopEvents = watchStopEvents()

      const { result: recorded, operations } = await profileOperations(
        UnplannedStop.collection.collectionName,
        () => service.recordClosedFromRunMode(wcId, startAt, endAt),
      )

      const writes = operations.filter(op => op.op !== 'query')
      expect(writes.map(op => op.op)).toEqual(['insert'])
      expect(writes[0].command.documents[0].endAt).toEqual(endAt)
      const stops = await stopsOf(wcId)
      expect(stops).toHaveLength(1)
      expect(stops[0]._id.toString()).toBe(recorded._id.toString())
      expect(stops[0].source).toBe('run_mode')
      expect(stops[0].startAt.toISOString()).toBe(startAt.toISOString())
      expect(stops[0].endAt?.toISOString()).toBe(endAt.toISOString())
      expect(stopEvents.opened).toHaveBeenCalledExactlyOnceWith(recorded._id.toString(), wcId)
      expect(stopEvents.closed).toHaveBeenCalledExactlyOnceWith(recorded._id.toString(), wcId)
      expect(stopEvents.opened.mock.invocationCallOrder[0]).toBeLessThan(
        stopEvents.closed.mock.invocationCallOrder[0],
      )
    })

    it('records a closed run-mode stop once when it is written twice', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      const endAt = new Date('2026-06-15T10:05:00.000Z')
      const stopEvents = watchStopEvents()

      const first = await service.recordClosedFromRunMode(wcId, startAt, endAt)
      const second = await service.recordClosedFromRunMode(wcId, startAt, endAt)

      expect(second._id.toString()).toBe(first._id.toString())
      expect(await stopsOf(wcId)).toHaveLength(1)
      expect(stopEvents.opened).toHaveBeenCalledTimes(1)
      expect(stopEvents.closed).toHaveBeenCalledTimes(1)
    })

    it('records a closed run-mode stop once when two writers race', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      const endAt = new Date('2026-06-15T10:05:00.000Z')

      const [first, second] = await Promise.all([
        service.recordClosedFromRunMode(wcId, startAt, endAt),
        service.recordClosedFromRunMode(wcId, startAt, endAt),
      ])

      expect(second._id.toString()).toBe(first._id.toString())
      expect(await stopsOf(wcId)).toHaveLength(1)
    })

    it('returns the stop with the same start when the work center has other run-mode stops', async () => {
      const wcId = new Types.ObjectId().toString()
      await service.recordClosedFromRunMode(
        wcId,
        new Date('2026-06-15T09:00:00.000Z'),
        new Date('2026-06-15T09:05:00.000Z'),
      )
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      const endAt = new Date('2026-06-15T10:05:00.000Z')
      const wanted = await service.recordClosedFromRunMode(wcId, startAt, endAt)

      const recordedAgain = await service.recordClosedFromRunMode(wcId, startAt, endAt)
      const openedAgain = await service.openFromRunMode(wcId, startAt)

      expect(recordedAgain._id.toString()).toBe(wanted._id.toString())
      expect(openedAgain._id.toString()).toBe(wanted._id.toString())
      expect(await stopsOf(wcId)).toHaveLength(2)
    })

    it('marks a recorded stop no longer than the micro stop threshold as a micro stop', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')

      const recorded = await service.recordClosedFromRunMode(
        wcId,
        startAt,
        new Date(startAt.getTime() + 90_000),
      )

      const [stored] = await stopsOf(wcId)
      expect(recorded.reasonId?.toString()).toBe(await microStopReasonId())
      expect(stored.reasonId?.toString()).toBe(await microStopReasonId())
    })

    it('marks a recorded stop lasting exactly the micro stop threshold as a micro stop', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')

      await service.recordClosedFromRunMode(wcId, startAt, new Date(startAt.getTime() + 120_000))

      const [stored] = await stopsOf(wcId)
      expect(stored.reasonId?.toString()).toBe(await microStopReasonId())
    })

    it('does not mark a recorded stop longer than the micro stop threshold as a micro stop', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')

      const recorded = await service.recordClosedFromRunMode(
        wcId,
        startAt,
        new Date(startAt.getTime() + 120_001),
      )

      const [stored] = await stopsOf(wcId)
      expect(recorded.reasonId).toBeNull()
      expect(stored.reasonId).toBeNull()
    })

    it("applies the work center's micro stop threshold", async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      await policyService.upsertForWorkCenter(wcId, { microStopThresholdMs: 30_000 }, userId)

      await service.recordClosedFromRunMode(wcId, startAt, new Date(startAt.getTime() + 90_000))

      const [stored] = await stopsOf(wcId)
      expect(stored.reasonId).toBeNull()
    })

    it('leaves an open manual stop open when it records a closed run-mode stop', async () => {
      const wcId = new Types.ObjectId().toString()
      const manual = await service.createManual(
        { workCenterId: wcId, startAt: new Date('2026-06-15T09:50:00.000Z') },
        userId,
      )
      const manualBefore = await UnplannedStop.findById(manual._id).lean()
      const stopEvents = watchStopEvents()

      const recorded = await service.recordClosedFromRunMode(
        wcId,
        new Date('2026-06-15T10:00:00.000Z'),
        new Date('2026-06-15T10:05:00.000Z'),
      )

      expect(recorded._id.toString()).not.toBe(manual._id.toString())
      expect(recorded.endAt?.toISOString()).toBe('2026-06-15T10:05:00.000Z')
      expect(await UnplannedStop.findById(manual._id).lean()).toEqual(manualBefore)
      expect(manualBefore?.endAt).toBeNull()
      expect(await stopsOf(wcId)).toHaveLength(2)
      expect(stopEvents.closed).toHaveBeenCalledExactlyOnceWith(recorded._id.toString(), wcId)
    })

    it('records a run-mode stop that starts when a manual stop started', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      const endAt = new Date('2026-06-15T10:05:00.000Z')
      await service.createManual({ workCenterId: wcId, startAt, endAt }, userId)

      const recorded = await service.recordClosedFromRunMode(wcId, startAt, endAt)

      expect(recorded.source).toBe('run_mode')
      expect(await stopsOf(wcId)).toHaveLength(2)
    })
  })

  describe('closeIfOpen', () => {
    it('returns null when nothing is open', async () => {
      const wcId = new Types.ObjectId().toString()
      const result = await service.closeIfOpen(wcId, new Date(), { closedBy: userId })
      expect(result).toBeNull()
    })

    it('tags MICRO_STOP when duration <= threshold and no reason set', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      await service.openFromRunMode(wcId, startAt)
      const endAt = new Date(startAt.getTime() + 60_000) // 1 min (threshold 120s)
      const closed = await service.closeIfOpen(wcId, endAt, { closedBy: userId })
      expect(closed).not.toBeNull()
      const microStop = await Reason.findOne({
        code: MICRO_STOP_CODE,
        isSystemDefault: true,
      }).lean()
      expect(closed?.reasonId?.toString()).toBe(microStop?._id.toString())
    })

    it('does NOT tag MICRO_STOP when duration > threshold', async () => {
      const wcId = new Types.ObjectId().toString()
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      await service.openFromRunMode(wcId, startAt)
      const endAt = new Date(startAt.getTime() + 10 * 60_000) // 10 min
      const closed = await service.closeIfOpen(wcId, endAt, { closedBy: userId })
      expect(closed?.reasonId).toBeNull()
    })

    it('preserves operator-assigned reason and does NOT overwrite with MICRO_STOP', async () => {
      const wcId = new Types.ObjectId().toString()
      const opReason = await seedReason()
      // Manually create with an operator reason, then close
      await UnplannedStop.create({
        workCenterId: new Types.ObjectId(wcId),
        reasonId: opReason._id,
        source: 'manual',
        startAt: new Date('2026-06-15T10:00:00.000Z'),
        operatorId: new Types.ObjectId(userId),
        createdBy: new Types.ObjectId(userId),
      })
      const closed = await service.closeIfOpen(wcId, new Date('2026-06-15T10:00:30.000Z'), {
        closedBy: userId,
      })
      expect(closed?.reasonId?.toString()).toBe(opReason._id.toString())
    })
  })

  describe('closeOnRunning', () => {
    it('deletes an untouched run-mode stop that ends shorter than the debounce it was opened under', async () => {
      const wcId = new Types.ObjectId().toString()
      await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'), 60_000)

      const result = await service.closeOnRunning(wcId, new Date('2026-06-15T10:00:20.000Z'))

      expect(result).toBeNull()
      expect(await stopsOf(wcId)).toHaveLength(0)
    })

    it('publishes unplanned_stop.updated when it deletes a stop, as a manual delete does', async () => {
      const wcId = new Types.ObjectId().toString()
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'), 60_000)
      const manualWcId = new Types.ObjectId().toString()
      const manual = await service.createManual(
        { workCenterId: manualWcId, startAt: new Date('2026-06-15T10:00:00.000Z') },
        userId,
      )
      const stopEvents = watchStopEvents()

      await service.closeOnRunning(wcId, new Date('2026-06-15T10:00:20.000Z'))
      await service.remove(manual._id.toString(), userId)

      expect(stopEvents.updated).toHaveBeenCalledTimes(2)
      expect(stopEvents.updated).toHaveBeenNthCalledWith(1, stop._id.toString(), wcId)
      expect(stopEvents.updated).toHaveBeenNthCalledWith(2, manual._id.toString(), manualWcId)
      expect(stopEvents.closed).not.toHaveBeenCalled()
    })

    it('does not delete a short run-mode stop that is already closed', async () => {
      const wcId = new Types.ObjectId().toString()
      const closedStop = await service.recordClosedFromRunMode(
        wcId,
        new Date('2026-06-15T10:00:00.000Z'),
        new Date('2026-06-15T10:00:10.000Z'),
      )

      const result = await service.closeOnRunning(wcId, new Date('2026-06-15T10:00:20.000Z'))

      expect(result).toBeNull()
      const stops = await stopsOf(wcId)
      expect(stops.map(s => s._id.toString())).toEqual([closedStop._id.toString()])
      expect(stops[0].endAt?.toISOString()).toBe('2026-06-15T10:00:10.000Z')
    })

    it('leaves the open stop of another work center alone', async () => {
      const wcId = new Types.ObjectId().toString()
      const otherWcId = new Types.ObjectId().toString()
      const other = await service.openFromRunMode(
        otherWcId,
        new Date('2026-06-15T10:00:00.000Z'),
        60_000,
      )

      const result = await service.closeOnRunning(wcId, new Date('2026-06-15T10:00:20.000Z'))

      expect(result).toBeNull()
      const otherStops = await stopsOf(otherWcId)
      expect(otherStops.map(s => s._id.toString())).toEqual([other._id.toString()])
      expect(otherStops[0].endAt).toBeNull()
    })

    it('closes and keeps a short run-mode stop a user has changed', async () => {
      const wcId = new Types.ObjectId().toString()
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'), 60_000)
      const reason = await seedReason()
      await service.patch(stop._id.toString(), { reasonId: reason._id.toString() }, userId)

      const result = await service.closeOnRunning(wcId, new Date('2026-06-15T10:00:20.000Z'))

      expect(result?._id.toString()).toBe(stop._id.toString())
      const stops = await stopsOf(wcId)
      expect(stops).toHaveLength(1)
      expect(stops[0].endAt?.toISOString()).toBe('2026-06-15T10:00:20.000Z')
      expect(stops[0].updatedBy?.toString()).toBe(userId)
      expect(stops[0].reasonId?.toString()).toBe(reason._id.toString())
    })

    it('closes a manual stop on a running signal whatever its length', async () => {
      const startAt = new Date('2026-06-15T10:00:00.000Z')
      for (const durationMs of [20_000, 10 * 60_000]) {
        const wcId = new Types.ObjectId().toString()
        const manual = await service.createManual({ workCenterId: wcId, startAt }, userId)
        expect(manual.updatedBy).toBeNull()
        const endAt = new Date(startAt.getTime() + durationMs)

        const result = await service.closeOnRunning(wcId, endAt)

        expect(result?._id.toString()).toBe(manual._id.toString())
        const stops = await stopsOf(wcId)
        expect(stops).toHaveLength(1)
        expect(stops[0].endAt?.toISOString()).toBe(endAt.toISOString())
      }
    })

    it('closes and keeps a run-mode stop lasting exactly the debounce', async () => {
      const wcId = new Types.ObjectId().toString()
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'), 60_000)
      const stopEvents = watchStopEvents()

      const result = await service.closeOnRunning(wcId, new Date('2026-06-15T10:01:00.000Z'))

      expect(result?._id.toString()).toBe(stop._id.toString())
      const stops = await stopsOf(wcId)
      expect(stops).toHaveLength(1)
      expect(stops[0].endAt?.toISOString()).toBe('2026-06-15T10:01:00.000Z')
      expect(stopEvents.closed).toHaveBeenCalledExactlyOnceWith(stop._id.toString(), wcId)
      expect(stopEvents.updated).not.toHaveBeenCalled()
    })

    // At the end of a planned stop, or at once with a debounce of 0
    it('closes and keeps a short untouched run-mode stop opened without a debounce', async () => {
      const wcId = new Types.ObjectId().toString()
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'))

      const result = await service.closeOnRunning(wcId, new Date('2026-06-15T10:00:20.000Z'))

      expect(result?._id.toString()).toBe(stop._id.toString())
      const stops = await stopsOf(wcId)
      expect(stops).toHaveLength(1)
      expect(stops[0].endAt?.toISOString()).toBe('2026-06-15T10:00:20.000Z')
      expect(stops[0].reasonId?.toString()).toBe(await microStopReasonId())
    })

    it('returns null and publishes nothing when no stop is open', async () => {
      const wcId = new Types.ObjectId().toString()
      const stopEvents = watchStopEvents()

      const result = await service.closeOnRunning(wcId, new Date('2026-06-15T10:00:20.000Z'))

      expect(result).toBeNull()
      expect(stopEvents.closed).not.toHaveBeenCalled()
      expect(stopEvents.updated).not.toHaveBeenCalled()
    })
  })

  describe('close (manual by user)', () => {
    it('rejects double-close with 409', async () => {
      const wcId = new Types.ObjectId().toString()
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'))
      await service.close(
        stop._id.toString(),
        { endAt: new Date('2026-06-15T10:01:00.000Z') },
        userId,
      )
      await expect(
        service.close(stop._id.toString(), { endAt: new Date('2026-06-15T10:02:00.000Z') }, userId),
      ).rejects.toMatchObject({ statusCode: 409 })
    })

    it('applies MICRO_STOP auto-tag on short close with no reason', async () => {
      const wcId = new Types.ObjectId().toString()
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'))
      const closed = await service.close(
        stop._id.toString(),
        { endAt: new Date('2026-06-15T10:00:30.000Z') },
        userId,
      )
      const microStop = await Reason.findOne({
        code: MICRO_STOP_CODE,
        isSystemDefault: true,
      }).lean()
      expect(closed.reasonId?.toString()).toBe(microStop?._id.toString())
    })

    it('respects explicit reasonId on close and skips MICRO_STOP', async () => {
      const wcId = new Types.ObjectId().toString()
      const opReason = await seedReason()
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'))
      const closed = await service.close(
        stop._id.toString(),
        {
          endAt: new Date('2026-06-15T10:00:30.000Z'),
          reasonId: opReason._id.toString(),
        },
        userId,
      )
      expect(closed.reasonId?.toString()).toBe(opReason._id.toString())
    })
  })

  describe('remove', () => {
    it('deletes the stop and publishes unplanned_stop.updated', async () => {
      const wcId = new Types.ObjectId().toString()
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'))
      const stopEvents = watchStopEvents()

      await service.remove(stop._id.toString(), userId)

      expect(await stopsOf(wcId)).toHaveLength(0)
      expect(stopEvents.updated).toHaveBeenCalledExactlyOnceWith(stop._id.toString(), wcId)
    })

    it('rejects with 404 when the stop does not exist', async () => {
      const stopEvents = watchStopEvents()

      await expect(service.remove(new Types.ObjectId().toString(), userId)).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(stopEvents.updated).not.toHaveBeenCalled()
    })
  })

  describe('convertToPlanned', () => {
    it('creates a new planned stop inheriting the same workCenterId', async () => {
      const wcId = new Types.ObjectId().toString()
      const reason = await seedReason({ canConvertFromUnplanned: true })
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'))
      await service.close(
        stop._id.toString(),
        {
          endAt: new Date('2026-06-15T10:10:00.000Z'),
          reasonId: reason._id.toString(),
        },
        userId,
      )

      const converted = await service.convertToPlanned(
        stop._id.toString(),
        { reasonId: reason._id.toString() },
        userId,
      )
      expect(converted.convertedToPlannedStopId).not.toBeNull()

      const planned = await PlannedStop.findById(converted.convertedToPlannedStopId).lean()
      expect(planned).not.toBeNull()
      expect(planned?.workCenterId.toString()).toBe(wcId)
      expect(planned?.source).toBe('converted')
      expect(planned?.status).toBe('closed')
    })

    it('rejects when target planned stop is on a different work center', async () => {
      const wcA = new Types.ObjectId().toString()
      const wcB = new Types.ObjectId().toString()
      const reason = await seedReason({ canConvertFromUnplanned: true })
      const stop = await service.openFromRunMode(wcA, new Date('2026-06-15T10:00:00.000Z'))
      await service.close(
        stop._id.toString(),
        {
          endAt: new Date('2026-06-15T10:10:00.000Z'),
          reasonId: reason._id.toString(),
        },
        userId,
      )

      const otherPlanned = await PlannedStop.create({
        workCenterId: new Types.ObjectId(wcB),
        reasonId: reason._id,
        plannedOwnerId: new Types.ObjectId(userId),
        source: 'manual',
        startMode: 'manual',
        status: 'closed',
        plannedStartAt: new Date('2026-06-15T09:00:00.000Z'),
        plannedEndAt: new Date('2026-06-15T09:30:00.000Z'),
        actualStartAt: new Date('2026-06-15T09:00:00.000Z'),
        actualEndAt: new Date('2026-06-15T09:30:00.000Z'),
        createdBy: new Types.ObjectId(userId),
      })

      await expect(
        service.convertToPlanned(
          stop._id.toString(),
          {
            plannedStopId: otherPlanned._id.toString(),
            reasonId: reason._id.toString(),
          },
          userId,
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.conversion_work_center_mismatch',
      })
    })

    it('rejects when reason cannot convert from unplanned', async () => {
      const wcId = new Types.ObjectId().toString()
      const reason = await seedReason({ canConvertFromUnplanned: false })
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'))
      await expect(
        service.convertToPlanned(stop._id.toString(), { reasonId: reason._id.toString() }, userId),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'error.reason_cannot_convert',
      })
    })

    it('rejects double conversion with 409', async () => {
      const wcId = new Types.ObjectId().toString()
      const reason = await seedReason({ canConvertFromUnplanned: true })
      const stop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'))
      await service.close(
        stop._id.toString(),
        {
          endAt: new Date('2026-06-15T10:10:00.000Z'),
          reasonId: reason._id.toString(),
        },
        userId,
      )
      await service.convertToPlanned(
        stop._id.toString(),
        { reasonId: reason._id.toString() },
        userId,
      )
      await expect(
        service.convertToPlanned(stop._id.toString(), { reasonId: reason._id.toString() }, userId),
      ).rejects.toMatchObject({ statusCode: 409 })
    })
  })

  describe('list derived-state filter', () => {
    it('filters by state=open, closed, converted', async () => {
      const wcId = new Types.ObjectId().toString()
      const reason = await seedReason({ canConvertFromUnplanned: true })

      const openStop = await service.openFromRunMode(wcId, new Date('2026-06-15T10:00:00.000Z'))
      const closedDoc = await UnplannedStop.create({
        workCenterId: new Types.ObjectId(new Types.ObjectId().toString()),
        source: 'manual',
        startAt: new Date('2026-06-15T09:00:00.000Z'),
        endAt: new Date('2026-06-15T09:05:00.000Z'),
        reasonId: reason._id,
        operatorId: new Types.ObjectId(userId),
        createdBy: new Types.ObjectId(userId),
      })
      const convertedDoc = await UnplannedStop.create({
        workCenterId: new Types.ObjectId(new Types.ObjectId().toString()),
        source: 'manual',
        startAt: new Date('2026-06-15T08:00:00.000Z'),
        endAt: new Date('2026-06-15T08:05:00.000Z'),
        reasonId: reason._id,
        convertedToPlannedStopId: new Types.ObjectId(),
        operatorId: new Types.ObjectId(userId),
        createdBy: new Types.ObjectId(userId),
      })

      const openRes = await service.list({ state: 'open' })
      expect(openRes.data.map(d => d._id.toString())).toEqual([openStop._id.toString()])

      const closedRes = await service.list({ state: 'closed' })
      expect(closedRes.data.map(d => d._id.toString())).toEqual([closedDoc._id.toString()])

      const convertedRes = await service.list({ state: 'converted' })
      expect(convertedRes.data.map(d => d._id.toString())).toEqual([convertedDoc._id.toString()])
    })
  })

  describe('patch validator — workCenterId immutable', () => {
    it('rejects workCenterId with specific i18n code', () => {
      const res = patchUnplannedStopSchema.safeParse({
        workCenterId: new Types.ObjectId().toString(),
        description: 'x',
      })
      expect(res.success).toBe(false)
      if (!res.success) {
        const messages = res.error.issues.map(i => i.message)
        expect(messages).toContain('error.unplanned_stop_work_center_immutable')
      }
    })

    it('accepts a non-workCenterId patch', () => {
      const res = patchUnplannedStopSchema.safeParse({ description: 'foo' })
      expect(res.success).toBe(true)
    })
  })
})

describe('UnplannedStopService list index', () => {
  it("pages the unplanned stops of the caller's work centers from an index, newest first", async () => {
    await UnplannedStop.createIndexes()
    const workCenters = Array.from({ length: 12 }, () => new Types.ObjectId())
    await UnplannedStop.collection.insertMany(
      workCenters.flatMap((workCenterId, w) =>
        Array.from({ length: 100 }, (_, i) => {
          const at = new Date(Date.UTC(2026, 0, 1, 0, w * 100 + i))
          return {
            workCenterId,
            source: 'manual',
            startAt: at,
            endAt: new Date(at.getTime() + 60_000),
            createdAt: at,
          }
        }),
      ),
    )

    const { result, operations } = await profileOperations(
      UnplannedStop.collection.collectionName,
      () =>
        service.list({
          page: 1,
          limit: 20,
          accessibleWorkCenterIds: workCenters.slice(0, 3).map(String),
        }),
    )

    expect(result.data).toHaveLength(20)
    const find = operations.find(op => op.op === 'query')
    expect(find?.planSummary).toContain('IXSCAN { workCenterId: 1, createdAt: -1, _id: -1 }')
    expect(find?.hasSortStage).toBeFalsy()
    expect(find?.keysExamined).toBeLessThanOrEqual(3 * 21)
  })
})
