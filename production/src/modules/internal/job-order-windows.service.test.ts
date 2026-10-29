import mongoose, { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { JobOrder } from '../job-order/job-order.model.js'
import { findJobOrderWindows } from './job-order-windows.service.js'

const HOUR = 3_600_000
const workCenterId = new Types.ObjectId()
const productId = new Types.ObjectId()
const actor = new Types.ObjectId()
let seq = 0

const jobOrder = (startTime: Date | null, endTime: Date | null) => ({
  code: `JO-${++seq}`,
  productId,
  workCenterId,
  targetQuantity: 100,
  startTime,
  endTime,
  createdBy: actor,
})

const query = (from: Date, to: Date) =>
  findJobOrderWindows({ workCenterId: workCenterId.toHexString(), from, to })

describe('findJobOrderWindows', () => {
  const from = new Date('2026-10-28T06:00:00.000Z')
  const to = new Date('2026-10-28T14:00:00.000Z')

  it('includes a job order that started long before the window and is still running', async () => {
    const running = await JobOrder.create(jobOrder(new Date('2025-01-01T00:00:00.000Z'), null))

    const windows = await query(from, to)

    expect(windows.map(w => w._id)).toEqual([running.id])
  })

  it('treats the window as half open: [from, to)', async () => {
    await JobOrder.create(jobOrder(new Date('2026-10-28T05:00:00.000Z'), from))
    const atFrom = await JobOrder.create(jobOrder(from, new Date('2026-10-28T07:00:00.000Z')))
    await JobOrder.create(jobOrder(to, null))

    const windows = await query(from, to)

    expect(windows.map(w => w._id)).toEqual([atFrom.id])
  })

  // A work center collects years of job orders. An OEE query must not scan that history,
  // whether it asks for the current shift or a shift a year ago.
  it('examines no more index keys than it returns, however long the history is', async () => {
    const now = new Date('2026-10-29T12:00:00.000Z').getTime()
    const history = []
    for (let k = 1; k <= 2 * 365 * 24; k++) {
      const start = new Date(now - k * HOUR)
      history.push(jobOrder(start, new Date(start.getTime() + 55 * 60_000)))
    }
    await JobOrder.collection.insertMany(history)

    const db = mongoose.connection.db as mongoose.mongo.Db
    await db.command({ profile: 0 })
    await db
      .collection('system.profile')
      .drop()
      .catch(() => undefined)
    await db.command({ profile: 2 })
    const currentShift = await query(new Date(now - 8 * HOUR), new Date(now))
    const yearAgo = now - 365 * 24 * HOUR
    const shiftYearAgo = await query(new Date(yearAgo - 8 * HOUR), new Date(yearAgo))
    await db.command({ profile: 0 })

    expect(currentShift).toHaveLength(8)
    expect(shiftYearAgo).toHaveLength(8)
    const ops = await db
      .collection('system.profile')
      .find({ ns: `${db.databaseName}.${JobOrder.collection.collectionName}`, op: 'query' })
      .toArray()
    expect(ops.length).toBeGreaterThan(0)
    for (const op of ops) {
      expect(op.planSummary).toContain('IXSCAN')
      expect(op.keysExamined).toBeLessThanOrEqual(op.nreturned + 1)
    }
  })
})
