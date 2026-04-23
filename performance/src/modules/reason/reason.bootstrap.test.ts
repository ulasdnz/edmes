import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import { bootstrapSystemReasons, MICRO_STOP_CODE } from './reason.bootstrap.js'
import { Reason } from './reason.model.js'

vi.mock('../../jobs/events.js', () => ({
  emit: vi.fn(),
  emitReasonCreated: vi.fn(),
  emitReasonUpdated: vi.fn(),
  emitReasonDeleted: vi.fn(),
}))

describe('bootstrapSystemReasons', () => {
  it('creates MICRO_STOP with required invariants when missing', async () => {
    await bootstrapSystemReasons()
    const doc = await Reason.findOne({ code: MICRO_STOP_CODE }).lean()

    expect(doc).not.toBeNull()
    expect(doc?.usages).toEqual(['unplanned_stop'])
    expect(doc?.affectsOee).toBe(false)
    expect(doc?.isSystemDefault).toBe(true)
    expect(doc?.isActive).toBe(true)
    expect(doc?.createdBy?.toString()).toBe(SYSTEM_IDENTITY)
  })

  it('does not overwrite existing MICRO_STOP', async () => {
    await bootstrapSystemReasons()
    const first = await Reason.findOne({ code: MICRO_STOP_CODE }).lean()

    await bootstrapSystemReasons()
    const second = await Reason.findOne({ code: MICRO_STOP_CODE }).lean()

    expect(second?._id.toString()).toBe(first?._id.toString())
    expect(second?.createdAt?.toISOString()).toBe(first?.createdAt?.toISOString())
  })

  it('throws when existing MICRO_STOP violates invariants', async () => {
    await Reason.create({
      code: MICRO_STOP_CODE,
      name: 'Micro Stop',
      usages: ['unplanned_stop'],
      affectsOee: true,
      isSystemDefault: true,
      isActive: true,
      createdBy: new Types.ObjectId(SYSTEM_IDENTITY),
    })

    await expect(bootstrapSystemReasons()).rejects.toThrow(/micro_stop_invalid/)
  })

  it('is safe against concurrent calls', async () => {
    await Promise.all([
      bootstrapSystemReasons(),
      bootstrapSystemReasons(),
      bootstrapSystemReasons(),
    ])

    const rows = await Reason.find({ code: MICRO_STOP_CODE }).lean()
    expect(rows.length).toBe(1)
  })
})
