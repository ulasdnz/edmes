import type { Types } from 'mongoose'
import { JobOrder } from '../job-order/job-order.model.js'
import type { JobOrderWindowsQuery } from './job-order-windows.validators.js'

export interface JobOrderWindow {
  _id: string
  workCenterId: string
  productId: string
  startTime: Date
  endTime: Date | null
}

type WindowDoc = {
  _id: Types.ObjectId
  workCenterId: Types.ObjectId
  productId: Types.ObjectId
  startTime: Date
  endTime: Date | null
}

const projection = '_id workCenterId productId startTime endTime'

// Started job orders of a work center that overlap [from, to), oldest first.
// Job orders on a work center never overlap (start and end reject it), so only the last one
// started before `from` can reach into the window and every other match started inside it.
// Both lookups are bounded scans on { workCenterId, startTime, endTime }: the cost follows the
// result size, not the length of the work center's history.
export async function findJobOrderWindows({
  workCenterId,
  from,
  to,
}: JobOrderWindowsQuery): Promise<JobOrderWindow[]> {
  const [before, inside] = await Promise.all([
    JobOrder.findOne({ workCenterId, startTime: { $lt: from } })
      .sort({ startTime: -1 })
      .select(projection)
      .lean<WindowDoc>(),
    JobOrder.find({
      workCenterId,
      startTime: { $gte: from, $lt: to },
      $or: [{ endTime: null }, { endTime: { $gt: from } }],
    })
      .sort({ startTime: 1 })
      .select(projection)
      .lean<WindowDoc[]>(),
  ])

  const reachesIn = before !== null && (before.endTime === null || before.endTime > from)
  return (reachesIn ? [before, ...inside] : inside).map(doc => ({
    _id: doc._id.toString(),
    workCenterId: doc.workCenterId.toString(),
    productId: doc.productId.toString(),
    startTime: doc.startTime,
    endTime: doc.endTime,
  }))
}
