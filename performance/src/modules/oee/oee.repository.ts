import { Types } from 'mongoose'
import { PlannedStop } from '../planned-stop/planned-stop.model.js'
import * as reasonService from '../reason/reason.service.js'
import { UnplannedStop } from '../unplanned-stop/unplanned-stop.model.js'
import type { StopInterval } from './oee.types.js'

export type FindStopsInput = {
  workCenterId: string
  from: Date
  to: Date
  excludeSystemReasonCodes?: string[]
}

export type FindStopsResult = {
  planned: StopInterval[]
  unplanned: StopInterval[]
  microStopReasonId: string
}

type PlannedProjection = {
  _id: Types.ObjectId
  workCenterId: Types.ObjectId
  reasonId: Types.ObjectId
  status: string
  plannedStartAt: Date
  plannedEndAt: Date
  actualStartAt: Date | null
  actualEndAt: Date | null
}

type UnplannedProjection = {
  _id: Types.ObjectId
  workCenterId: Types.ObjectId
  reasonId: Types.ObjectId | null
  startAt: Date
  endAt: Date | null
  convertedToPlannedStopId: Types.ObjectId | null
}

export async function findStopsForOee(input: FindStopsInput): Promise<FindStopsResult> {
  const microStopObjId = await reasonService.getSystemReasonIdByCode('MICRO_STOP')
  const microStopReasonId = microStopObjId.toString()
  const wc = new Types.ObjectId(input.workCenterId)

  const plannedDocs = await PlannedStop.find({
    workCenterId: wc,
    status: { $in: ['active', 'closed'] },
    plannedStartAt: { $lt: input.to },
    $or: [
      { actualEndAt: { $gt: input.from } },
      { actualEndAt: null, plannedEndAt: { $gt: input.from } },
      { status: 'active' },
    ],
  })
    .select({
      _id: 1,
      workCenterId: 1,
      reasonId: 1,
      status: 1,
      plannedStartAt: 1,
      plannedEndAt: 1,
      actualStartAt: 1,
      actualEndAt: 1,
    })
    .lean<PlannedProjection[]>()

  const now = new Date()
  const planned: StopInterval[] = []
  for (const p of plannedDocs) {
    const startAt = p.actualStartAt ?? p.plannedStartAt
    if (!startAt) continue

    let endAt: Date
    if (p.actualEndAt) {
      endAt = p.actualEndAt
    } else {
      const capMs = Math.min(input.to.getTime(), now.getTime(), p.plannedEndAt.getTime())
      endAt = new Date(capMs)
    }
    if (endAt.getTime() > p.plannedEndAt.getTime()) endAt = p.plannedEndAt
    if (endAt.getTime() <= startAt.getTime()) continue

    planned.push({
      _id: p._id.toString(),
      workCenterId: p.workCenterId.toString(),
      reasonId: p.reasonId.toString(),
      source: 'planned',
      start: startAt,
      end: endAt,
    })
  }

  const unplannedDocs = await UnplannedStop.find({
    workCenterId: wc,
    reasonId: { $ne: microStopObjId },
    startAt: { $lt: input.to },
    $or: [{ endAt: null }, { endAt: { $gt: input.from } }],
  })
    .select({
      _id: 1,
      workCenterId: 1,
      reasonId: 1,
      startAt: 1,
      endAt: 1,
      convertedToPlannedStopId: 1,
    })
    .lean<UnplannedProjection[]>()

  const unplanned: StopInterval[] = []
  for (const u of unplannedDocs) {
    const startAt = u.startAt
    const endAt = u.endAt ?? input.to
    if (endAt.getTime() <= startAt.getTime()) continue

    unplanned.push({
      _id: u._id.toString(),
      workCenterId: u.workCenterId.toString(),
      reasonId: u.reasonId ? u.reasonId.toString() : null,
      source: 'unplanned',
      start: startAt,
      end: endAt,
      linkedPlannedStopId: u.convertedToPlannedStopId
        ? u.convertedToPlannedStopId.toString()
        : null,
    })
  }

  return { planned, unplanned, microStopReasonId }
}
