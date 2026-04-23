import mongoose, { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { Reason } from './reason.model.js'
import * as service from './reason.service.js'
import type { CreateReasonInput } from './reason.validators.js'

vi.mock('../../jobs/events.js', () => ({
  emit: vi.fn(),
  emitReasonCreated: vi.fn(),
  emitReasonUpdated: vi.fn(),
  emitReasonDeleted: vi.fn(),
}))

const userId = new Types.ObjectId().toString()

const buildReason = (overrides: Partial<CreateReasonInput> = {}): CreateReasonInput => ({
  code: `R_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
  name: `Reason ${Date.now()}_${Math.floor(Math.random() * 10000)}`,
  usages: ['unplanned_stop'],
  affectsOee: true,
  ...overrides,
})

describe('ReasonService', () => {
  describe('create', () => {
    it('creates with valid data and assigns createdBy', async () => {
      const input = buildReason()
      const doc = await service.create(input, userId)

      expect(doc.code).toBe(input.code)
      expect(doc.createdBy?.toString()).toBe(userId)
      expect(doc.isSystemDefault).toBe(false)
    })

    it('rejects duplicate code with 409', async () => {
      const input = buildReason({ code: 'DUP_CODE' })
      await service.create(input, userId)

      await expect(
        service.create({ ...input, name: `Other ${Date.now()}` }, userId),
      ).rejects.toMatchObject({ statusCode: 409 })
    })

    it('rejects duplicate name with 409', async () => {
      const input = buildReason({ name: 'Duplicate Name X' })
      await service.create(input, userId)

      await expect(
        service.create({ ...input, code: `OTHER_${Date.now()}` }, userId),
      ).rejects.toMatchObject({ statusCode: 409 })
    })
  })

  describe('getById', () => {
    it('returns record when found', async () => {
      const created = await service.create(buildReason(), userId)
      const found = await service.getById(created._id.toString())
      expect(found._id.toString()).toBe(created._id.toString())
    })

    it('throws 404 when not found', async () => {
      await expect(service.getById(new Types.ObjectId().toString())).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('list', () => {
    it('returns all matching records as a flat array', async () => {
      await service.create(buildReason(), userId)
      await service.create(buildReason(), userId)

      const rows = await service.list({} as Parameters<typeof service.list>[0])
      expect(Array.isArray(rows)).toBe(true)
      expect(rows.length).toBeGreaterThanOrEqual(2)
    })

    it('projects only _id when fields=_id', async () => {
      await service.create(buildReason(), userId)
      const rows = await service.list({
        fields: ['_id'],
      } as unknown as Parameters<typeof service.list>[0])

      for (const row of rows) {
        expect(Object.keys(row as object).sort()).toEqual(['_id'])
      }
    })

    it('filters by affectsOee and usage intersection', async () => {
      const a = await service.create(
        buildReason({ usages: ['planned_stop'], affectsOee: false }),
        userId,
      )
      const b = await service.create(
        buildReason({ usages: ['unplanned_stop'], affectsOee: true }),
        userId,
      )
      const c = await service.create(buildReason({ usages: ['scrap'], affectsOee: false }), userId)

      const rows = await service.list({
        affectsOee: false,
        usage: ['planned_stop', 'unplanned_stop', 'scrap'],
        fields: ['_id'],
      } as unknown as Parameters<typeof service.list>[0])

      const ids = rows.map(r => (r as { _id: Types.ObjectId })._id.toString())
      expect(ids).toContain(a._id.toString())
      expect(ids).toContain(c._id.toString())
      expect(ids).not.toContain(b._id.toString())
    })
  })

  describe('update', () => {
    it('updates an editable reason', async () => {
      const created = await service.create(buildReason(), userId)
      const updated = await service.update(
        created._id.toString(),
        { name: 'Renamed Reason' },
        userId,
      )
      expect(updated.name).toBe('Renamed Reason')
      expect(updated.updatedBy?.toString()).toBe(userId)
    })

    it('rejects updating system-default reason with 409', async () => {
      const existing = await Reason.create({
        code: 'SYS_X',
        name: 'System X',
        usages: ['unplanned_stop'],
        affectsOee: false,
        isSystemDefault: true,
        isActive: true,
        createdBy: new Types.ObjectId(userId),
      })

      await expect(
        service.update(existing._id.toString(), { name: 'Changed' }, userId),
      ).rejects.toMatchObject({ statusCode: 409 })
    })

    it('returns 404 when updating non-existent reason', async () => {
      await expect(
        service.update(new Types.ObjectId().toString(), { name: 'X' }, userId),
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('remove', () => {
    it('hard-deletes when not referenced', async () => {
      const created = await service.create(buildReason(), userId)
      await service.remove(created._id.toString(), userId)
      expect(await Reason.findById(created._id)).toBeNull()
    })

    it('rejects removing system-default reason with 409', async () => {
      const doc = await Reason.create({
        code: 'SYS_Y',
        name: 'System Y',
        usages: ['unplanned_stop'],
        affectsOee: false,
        isSystemDefault: true,
        isActive: true,
        createdBy: new Types.ObjectId(userId),
      })
      await expect(service.remove(doc._id.toString(), userId)).rejects.toMatchObject({
        statusCode: 409,
      })
    })

    it('soft-deletes when referenced by a stop-like collection', async () => {
      const created = await service.create(buildReason(), userId)

      const stubSchema = new mongoose.Schema({ reasonId: mongoose.Schema.Types.ObjectId })
      const modelName = 'PlannedStop'
      const StubModel = mongoose.models[modelName] ?? mongoose.model(modelName, stubSchema)
      await StubModel.create({ reasonId: created._id })

      try {
        const result = await service.remove(created._id.toString(), userId)
        expect(result.isActive).toBe(false)
        const fresh = await Reason.findById(created._id).lean()
        expect(fresh?.isActive).toBe(false)
      } finally {
        await StubModel.deleteMany({})
      }
    })
  })

  describe('getSystemReasonIdByCode', () => {
    it('returns id when system reason exists', async () => {
      const created = await Reason.create({
        code: 'SYS_READABLE',
        name: 'Sys Readable',
        usages: ['unplanned_stop'],
        affectsOee: false,
        isSystemDefault: true,
        isActive: true,
        createdBy: new Types.ObjectId(userId),
      })

      const found = await service.getSystemReasonIdByCode('SYS_READABLE')
      expect(found.toString()).toBe(created._id.toString())
    })

    it('throws 500 when missing', async () => {
      await expect(service.getSystemReasonIdByCode('MISSING_CODE')).rejects.toMatchObject({
        statusCode: 500,
      })
    })
  })

  describe('performance', () => {
    it('uses index scan for usages+affectsOee query', async () => {
      await service.create(buildReason({ usages: ['planned_stop'], affectsOee: true }), userId)

      const plan = await Reason.find({ usages: { $in: ['planned_stop'] }, affectsOee: true })
        .select({ _id: 1 })
        .explain('queryPlanner')

      const stage = JSON.stringify(plan)
      expect(stage).toMatch(/IXSCAN/)
    })
  })
})
