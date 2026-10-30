import { CustomError } from '@mes/core'
import { type PaginatedResult, paginate } from '@mes/core/pagination'
import {
  emitQuantityAdjustmentCreated,
  emitQuantityAdjustmentDeleted,
  emitQuantityAdjustmentUpdated,
} from '../../jobs/events.js'
import { assertShiftExists } from '../../lib/internal-api.js'
import { limitToVisibleWorkCenters } from '../../utils/visibility.js'
import { JobOrder } from '../job-order/job-order.model.js'
import { type IQuantityAdjustment, QuantityAdjustment } from './quantity-adjustment.model.js'
import type {
  CreateQuantityAdjustmentInput,
  PatchQuantityAdjustmentInput,
  QuantityAdjustmentListInput,
} from './quantity-adjustment.validators.js'

function assertVisible(workCenterId: string, visibleIds?: string[]): void {
  if (!visibleIds) return
  if (!visibleIds.includes(workCenterId)) {
    throw new CustomError(404, 'error.not_found')
  }
}

export async function create(
  data: CreateQuantityAdjustmentInput,
  userId: string,
  visibleIds?: string[],
): Promise<IQuantityAdjustment> {
  if (data.shiftId) await assertShiftExists(String(data.shiftId))

  const jo = await JobOrder.findById(data.jobOrderId)
  if (!jo) throw new CustomError(404, 'error.not_found')
  assertVisible(jo.workCenterId.toString(), visibleIds)
  if (!jo.startTime) throw new CustomError(400, 'error.job_order_not_started_for_adjustment')

  if (data.amount === 0) throw new CustomError(400, 'error.amount_zero')
  if (data.time < jo.startTime) {
    throw new CustomError(400, 'error.job_order_time_before_start')
  }

  const doc = await QuantityAdjustment.create({
    ...data,
    workCenterId: jo.workCenterId,
    productId: jo.productId,
    createdBy: userId,
  })
  emitQuantityAdjustmentCreated(
    doc._id.toString(),
    doc.jobOrderId.toString(),
    doc.workCenterId.toString(),
  )
  return doc
}

export async function getById(id: string): Promise<IQuantityAdjustment> {
  const doc = await QuantityAdjustment.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IQuantityAdjustment
}

export async function list(
  input: QuantityAdjustmentListInput,
  visibleIds?: string[],
): Promise<PaginatedResult<IQuantityAdjustment>> {
  const { page, limit, sort, timeFrom, timeTo, createdAtFrom, createdAtTo, ...filters } = input
  const query: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query[key] = value
  }

  if (timeFrom || timeTo) {
    query.time = {
      ...(timeFrom && { $gte: timeFrom }),
      ...(timeTo && { $lte: timeTo }),
    }
  }
  if (createdAtFrom || createdAtTo) {
    query.createdAt = {
      ...(createdAtFrom && { $gte: createdAtFrom }),
      ...(createdAtTo && { $lte: createdAtTo }),
    }
  }

  limitToVisibleWorkCenters(query, visibleIds)

  return paginate(
    QuantityAdjustment,
    query,
    { page, limit, sort },
    { allowedSortFields: ['time', 'amount', 'createdAt', 'updatedAt'] },
  )
}

export async function update(
  id: string,
  data: PatchQuantityAdjustmentInput,
  userId: string,
  visibleIds?: string[],
): Promise<IQuantityAdjustment> {
  if (data.shiftId) await assertShiftExists(String(data.shiftId))

  const qa = await QuantityAdjustment.findById(id)
  if (!qa) throw new CustomError(404, 'error.not_found')
  assertVisible(qa.workCenterId.toString(), visibleIds)

  if (data.amount !== undefined && data.amount === 0) {
    throw new CustomError(400, 'error.amount_zero')
  }

  if (data.time) {
    const jo = await JobOrder.findById(qa.jobOrderId)
    if (jo?.startTime && data.time < jo.startTime) {
      throw new CustomError(400, 'error.job_order_time_before_start')
    }
  }

  const doc = await QuantityAdjustment.findOneAndUpdate(
    { _id: id },
    { $set: { ...data, updatedBy: userId } },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitQuantityAdjustmentUpdated(id, qa.jobOrderId.toString(), qa.workCenterId.toString())
  return doc
}

export async function remove(id: string, visibleIds?: string[]): Promise<IQuantityAdjustment> {
  const doc = await QuantityAdjustment.findById(id)
  if (!doc) throw new CustomError(404, 'error.not_found')
  assertVisible(doc.workCenterId.toString(), visibleIds)
  await QuantityAdjustment.deleteOne({ _id: id })
  emitQuantityAdjustmentDeleted(id, doc.jobOrderId.toString(), doc.workCenterId.toString())
  return doc
}
