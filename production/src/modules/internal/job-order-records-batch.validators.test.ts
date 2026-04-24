import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { jobOrderRecordsBatchSchema } from './job-order-records-batch.validators.js'

const validItem = () => ({
  jobOrderId: new Types.ObjectId().toString(),
  from: '2026-03-05T00:00:00.000Z',
  to: '2026-03-05T12:00:00.000Z',
})

describe('jobOrderRecordsBatchSchema', () => {
  it('accepts ISO UTC strings with Z suffix', () => {
    const result = jobOrderRecordsBatchSchema.safeParse({
      include: ['quantity_adjustments'],
      items: [validItem()],
    })
    expect(result.success).toBe(true)
  })

  it('rejects offset-less / local datetime strings', () => {
    const result = jobOrderRecordsBatchSchema.safeParse({
      include: ['quantity_adjustments'],
      items: [{ ...validItem(), from: '2026-03-05T00:00:00' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects when from > to', () => {
    const result = jobOrderRecordsBatchSchema.safeParse({
      include: ['quantity_adjustments'],
      items: [
        {
          ...validItem(),
          from: '2026-03-05T12:00:00.000Z',
          to: '2026-03-05T00:00:00.000Z',
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('requires at least one entry in include', () => {
    const result = jobOrderRecordsBatchSchema.safeParse({
      include: [],
      items: [validItem()],
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown include values', () => {
    const result = jobOrderRecordsBatchSchema.safeParse({
      include: ['foo'],
      items: [validItem()],
    })
    expect(result.success).toBe(false)
  })

  it('rejects duplicate jobOrderIds across items', () => {
    const duplicateId = new Types.ObjectId().toString()
    const result = jobOrderRecordsBatchSchema.safeParse({
      include: ['quantity_adjustments'],
      items: [
        { ...validItem(), jobOrderId: duplicateId },
        {
          jobOrderId: duplicateId,
          from: '2026-03-06T00:00:00.000Z',
          to: '2026-03-06T12:00:00.000Z',
        },
      ],
    })
    expect(result.success).toBe(false)
  })
})
