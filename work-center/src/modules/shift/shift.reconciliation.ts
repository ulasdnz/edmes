import { Types } from 'mongoose'
import { config } from '../../config/index.js'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import { emitOperatorCheckedOut } from '../../jobs/events.js'
import { logger } from '../../lib/logger.js'
import { OperatorCheckIn } from '../operators/operators.model.js'
import { getEffectiveSchedule } from '../schedule/schedule.service.js'
import {
  computeOccurrenceDay,
  currentRunningOccurrence,
  occurrenceEndOnDay,
  type ShiftLike,
} from './shift.utils.js'

const RECONCILIATION_MAX_LOOKBACK_DAYS = 14

export async function reconcileOpenCheckInsAtStartup(): Promise<string[]> {
  const now = new Date()
  const tz = config.PLANT_TIMEZONE
  const today = computeOccurrenceDay(now, tz)
  const openCheckIns = await OperatorCheckIn.find({ checkedOutAt: null })
  const closedCheckInIds: string[] = []

  const effCache = new Map<string, Awaited<ReturnType<typeof getEffectiveSchedule>>>()
  const getEff = async (wcId: string, day: string) => {
    const key = `${wcId}|${day}`
    let eff = effCache.get(key)
    if (!eff) {
      eff = await getEffectiveSchedule(wcId, day)
      effCache.set(key, eff)
    }
    return eff
  }

  for (const ci of openCheckIns) {
    const wcId = String(ci.workCenterId)
    const checkedInAt = ci.checkedInAt
    if (!checkedInAt) continue

    const cap = new Date(now.getTime() - RECONCILIATION_MAX_LOOKBACK_DAYS * 24 * 3600 * 1000)
    const scanFrom = checkedInAt.getTime() < cap.getTime() ? cap : checkedInAt

    let earliestMissedEnd: Date | null = null
    const firstDay = computeOccurrenceDay(scanFrom, tz)
    let walkDay = addLocalDay(firstDay, -1)
    while (walkDay <= today) {
      const eff = await getEff(wcId, walkDay)
      for (const s of eff.shifts) {
        const shiftLike = s as unknown as ShiftLike
        const endedAt = occurrenceEndOnDay(shiftLike, walkDay, tz)
        if (
          endedAt.getTime() > scanFrom.getTime() &&
          endedAt.getTime() <= now.getTime() &&
          (earliestMissedEnd === null || endedAt.getTime() < earliestMissedEnd.getTime())
        ) {
          earliestMissedEnd = endedAt
        }
      }
      walkDay = addLocalDay(walkDay, 1)
    }

    let closeAt: Date | null = null
    if (earliestMissedEnd) {
      closeAt = earliestMissedEnd
    } else {
      let leaveAlone = false
      const yesterday = addLocalDay(today, -1)
      const daysToCheck = [yesterday, today]
      outer: for (const checkDay of daysToCheck) {
        const eff = await getEff(wcId, checkDay)
        for (const s of eff.shifts) {
          const shiftLike = s as unknown as ShiftLike
          const running = currentRunningOccurrence(shiftLike, now, tz)
          if (!running) continue
          if (running.occurrenceDay !== checkDay) continue
          if (
            running.startedAt.getTime() <= checkedInAt.getTime() &&
            checkedInAt.getTime() < running.endedAt.getTime()
          ) {
            leaveAlone = true
            break outer
          }
        }
      }
      if (!leaveAlone) closeAt = now
    }

    if (!closeAt) continue

    ci.checkedOutAt = closeAt
    ci.checkoutSource = 'shift_boundary'
    ci.updatedBy = new Types.ObjectId(SYSTEM_IDENTITY)
    await ci.save()
    await emitOperatorCheckedOut(wcId, String(ci.operatorId), String(ci._id), 'shift_boundary')
    closedCheckInIds.push(String(ci._id))
  }

  logger.info('Startup reconciliation completed', {
    event: 'shift.reconciliation.completed',
    openScanned: openCheckIns.length,
    closedCount: closedCheckInIds.length,
  })
  return closedCheckInIds
}

function addLocalDay(yyyyMmDd: string, delta: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number) as [number, number, number]
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + delta)
  const yy = base.getUTCFullYear()
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(base.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
