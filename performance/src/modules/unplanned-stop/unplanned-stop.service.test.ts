import { profileOperations } from '@mes/testing'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheDel, cacheWrap } = vi.hoisted(() => ({
  cacheDel: vi.fn(async () => {}),
  cacheWrap: vi.fn(async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader()),
}))

vi.mock('../../lib/cache.js', () => ({
  cacheDel,
  cacheWrap,
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDelPattern: vi.fn(),
  cacheWrapDedup: vi.fn(),
  sharedCacheWrapDedup: vi.fn(),
  sharedCacheDel: vi.fn(),
}))

import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import { bootstrapSystemReasons, MICRO_STOP_CODE } from '../reason/reason.bootstrap.js'
import { Reason } from '../reason/reason.model.js'
import { UnplannedStop } from './unplanned-stop.model.js'
import * as service from './unplanned-stop.service.js'
import { patchUnplannedStopSchema } from './unplanned-stop.validators.js'

const userId = new Types.ObjectId().toString()

async function seedReason(
  overrides: Partial<{
    code: string
    name: string
    usages: string[]
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

describe('UnplannedStopService', () => {
  beforeEach(async () => {
    await bootstrapSystemReasons()
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
