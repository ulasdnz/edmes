import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Shift } from '../../shift/shift.model.js'
import WorkCenter from '../../work-center/work-center.model.js'
import { Calendar, DateException } from '../schedule.model.js'
import * as scheduleService from '../schedule.service.js'

vi.mock('../../../jobs/events.js', () => ({
  emitScheduleChanged: vi.fn(),
}))

const userId = new Types.ObjectId().toHexString()

async function makeWc(shiftIds: Types.ObjectId[] = []) {
  return WorkCenter.create({
    code: 'WC1',
    name: 'WC1',
    type: 'physical',
    shiftIds,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })
}

async function makeShift(name: string, sh: number, eh: number) {
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

describe('schedule.service effective schedule uniform response', () => {
  beforeEach(async () => {
    await Promise.all([
      WorkCenter.deleteMany({}),
      Shift.deleteMany({}),
      Calendar.deleteMany({}),
      DateException.deleteMany({}),
    ])
  })

  it('returns source=none with empty arrays when no definition', async () => {
    const wc = await makeWc()
    const out = await scheduleService.getEffectiveSchedule(String(wc._id), '2026-04-10')
    expect(out).toEqual({ source: 'none', date: '2026-04-10', shiftIds: [], shifts: [] })
  })

  it('returns source=default with WorkCenter.shiftIds when no calendar/exception', async () => {
    const s = await makeShift('Day', 8, 16)
    const wc = await makeWc([s._id])
    const out = await scheduleService.getEffectiveSchedule(String(wc._id), '2026-04-10')
    expect(out.source).toBe('default')
    expect(out.shiftIds).toEqual([String(s._id)])
    expect(out.shifts).toHaveLength(1)
    expect(out.shifts[0]!.name).toBe('Day')
  })

  it('exception closed day returns empty arrays with source=exception', async () => {
    const s = await makeShift('Day', 8, 16)
    const wc = await makeWc([s._id])
    await scheduleService.upsertException(String(wc._id), '2026-04-10', { shiftIds: [] }, userId)
    const out = await scheduleService.getEffectiveSchedule(String(wc._id), '2026-04-10')
    expect(out.source).toBe('exception')
    expect(out.shiftIds).toEqual([])
    expect(out.shifts).toEqual([])
  })

  it('exception overrides calendar and default', async () => {
    const day = await makeShift('Day', 8, 16)
    const night = await makeShift('Night', 22, 6)
    const exceptionShift = await makeShift('Holiday', 9, 13)
    const wc = await makeWc([day._id])
    await scheduleService.upsertException(
      String(wc._id),
      '2026-04-10',
      { shiftIds: [String(exceptionShift._id)] },
      userId,
    )
    const out = await scheduleService.getEffectiveSchedule(String(wc._id), '2026-04-10')
    expect(out.source).toBe('exception')
    expect(out.shiftIds).toEqual([String(exceptionShift._id)])
  })
})

describe('schedule.service overlap enforcement', () => {
  beforeEach(async () => {
    await Promise.all([
      Shift.deleteMany({}),
      WorkCenter.deleteMany({}),
      DateException.deleteMany({}),
    ])
  })

  it('rejects exception with overlapping shift ids', async () => {
    const a = await makeShift('A', 8, 16)
    const b = await makeShift('B', 10, 18)
    const wc = await makeWc()
    await expect(
      scheduleService.upsertException(
        String(wc._id),
        '2026-04-10',
        { shiftIds: [String(a._id), String(b._id)] },
        userId,
      ),
    ).rejects.toMatchObject({ statusCode: 400, message: 'shift.overlap_in_assignment' })
  })

  it('rejects exception with duplicate shift id', async () => {
    const a = await makeShift('A', 8, 16)
    const wc = await makeWc()
    await expect(
      scheduleService.upsertException(
        String(wc._id),
        '2026-04-10',
        { shiftIds: [String(a._id), String(a._id)] },
        userId,
      ),
    ).rejects.toMatchObject({ statusCode: 400, message: 'shift.duplicate_in_assignment' })
  })

  it('rejects calendar day pattern containing overlapping shifts', async () => {
    const a = await makeShift('A', 8, 16)
    const b = await makeShift('B', 10, 18)
    const wc = await makeWc()
    await expect(
      scheduleService.createCalendar(
        String(wc._id),
        {
          validFrom: new Date('2026-04-01T00:00:00.000Z'),
          validTo: new Date('2026-05-01T00:00:00.000Z'),
          weeklyPattern: {
            monday: [String(a._id), String(b._id)],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: [],
            saturday: [],
            sunday: [],
          },
        },
        userId,
      ),
    ).rejects.toMatchObject({ statusCode: 400, message: 'shift.overlap_in_assignment' })
  })

  it('rejects when assigned shift id does not exist', async () => {
    const wc = await makeWc()
    const bogus = new Types.ObjectId().toHexString()
    await expect(
      scheduleService.upsertException(String(wc._id), '2026-04-10', { shiftIds: [bogus] }, userId),
    ).rejects.toMatchObject({ statusCode: 404, message: 'shift.not_found' })
  })
})
