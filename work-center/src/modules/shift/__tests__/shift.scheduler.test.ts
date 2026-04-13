import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitShiftEnded, emitShiftStarted } from '../../../jobs/events.js'
import { Shift } from '../shift.model.js'
import * as scheduler from '../shift.scheduler.js'

vi.mock('../../../jobs/events.js', () => ({
  emitShiftCreated: vi.fn(),
  emitShiftUpdated: vi.fn(),
  emitShiftDeleted: vi.fn(),
  emitShiftStarted: vi.fn(),
  emitShiftEnded: vi.fn(),
}))

const mockedStart = vi.mocked(emitShiftStarted)
const mockedEnd = vi.mocked(emitShiftEnded)
const userId = new Types.ObjectId().toHexString()

async function createShift(name: string, sh: number, eh: number) {
  return Shift.create({
    name,
    startHour: sh,
    startMinute: 0,
    endHour: eh,
    endMinute: 0,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
}

describe('shift.scheduler', () => {
  beforeEach(async () => {
    await Shift.deleteMany({})
    mockedStart.mockClear()
    mockedEnd.mockClear()
    // Pin wall clock to 2026-04-10 05:00 Istanbul (= 02:00 UTC)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T02:00:00.000Z'))
  })

  afterEach(async () => {
    await scheduler.stopShiftScheduler()
    vi.useRealTimers()
  })

  it('rebuilds timers from DB on start and fires start+end', async () => {
    const s = await createShift('Day', 8, 16) // 08:00-16:00 Istanbul
    await scheduler.startShiftScheduler()

    // Advance to 08:00 IST (05:00 UTC) → shift.started
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)

    expect(mockedStart).toHaveBeenCalledTimes(1)
    expect(mockedStart.mock.calls[0]![0]).toMatchObject({
      shiftId: String(s._id),
      occurrenceDay: '2026-04-10',
    })

    // Advance to 16:00 IST (13:00 UTC) → shift.ended
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
    expect(mockedEnd).toHaveBeenCalledTimes(1)
    expect(mockedEnd.mock.calls[0]![0]).toMatchObject({
      shiftId: String(s._id),
      occurrenceDay: '2026-04-10',
    })
  })

  it('onShiftCreated schedules a new shift mid-run', async () => {
    await scheduler.startShiftScheduler()
    const s = await createShift('Day', 8, 16)
    scheduler.onShiftCreated(
      s as unknown as {
        _id: unknown
        name: string
        startHour: number
        startMinute: number
        endHour: number
        endMinute: number
      },
    )
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(mockedStart).toHaveBeenCalledTimes(1)
  })

  it('onShiftDeleted cancels future timers (no events after delete)', async () => {
    const s = await createShift('Day', 8, 16)
    await scheduler.startShiftScheduler()
    scheduler.onShiftDeleted(String(s._id))
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(mockedStart).not.toHaveBeenCalled()
    expect(mockedEnd).not.toHaveBeenCalled()
  })

  it('onShiftUpdated reschedules cleanly (no duplicate timers)', async () => {
    const s = await createShift('Day', 8, 16)
    await scheduler.startShiftScheduler()
    // Change end to 17:00
    s.endHour = 17
    await s.save()
    scheduler.onShiftUpdated(
      s as unknown as {
        _id: unknown
        name: string
        startHour: number
        startMinute: number
        endHour: number
        endMinute: number
      },
    )

    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000) // → 08:00 IST

    expect(mockedStart).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(9 * 60 * 60 * 1000) // → 17:00 IST
    expect(mockedEnd).toHaveBeenCalledTimes(1)
  })

  it('does not publish synthetic shift.started when service boots mid-shift', async () => {
    // Pin time to 2026-04-10 12:00 IST (= 09:00 UTC). Shift 08-16 is currently running.
    vi.setSystemTime(new Date('2026-04-10T09:00:00.000Z'))
    const s = await createShift('Day', 8, 16)
    await scheduler.startShiftScheduler()

    // Advance ~4h up to just before today's 16:00 IST end → no events yet.
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 - 1)
    expect(mockedStart).not.toHaveBeenCalled()
    expect(mockedEnd).not.toHaveBeenCalled()

    // Cross 16:00 IST → end fires once for today's occurrence.
    await vi.advanceTimersByTimeAsync(1)

    expect(mockedEnd).toHaveBeenCalledTimes(1)
    expect(mockedEnd.mock.calls[0]![0]).toMatchObject({
      shiftId: String(s._id),
      occurrenceDay: '2026-04-10',
    })
    // Started must STILL not have been called for today.
    expect(mockedStart).not.toHaveBeenCalled()

    // Advance 16h to next day 08:00 IST → started fires for tomorrow's occurrence.
    await vi.advanceTimersByTimeAsync(16 * 60 * 60 * 1000)
    expect(mockedStart).toHaveBeenCalledTimes(1)
    expect(mockedStart.mock.calls[0]![0]).toMatchObject({
      shiftId: String(s._id),
      occurrenceDay: '2026-04-11',
    })
  })
})
