import { CustomError } from '@mes/core'
import {
  emitScrapEntryCreated,
  emitScrapEntryDeleted,
  emitScrapEntryUpdated,
} from '../../jobs/events.js'
import { type PaginatedResult, paginate } from '../../utils/pagination.js'
import { JobOrder } from '../job-order/job-order.model.js'
import { type IScrapEntry, ScrapEntry } from './scrap-entry.model.js'
import type {
  CreateScrapEntryInput,
  PatchScrapEntryInput,
  ScrapEntryListInput,
} from './scrap-entry.validators.js'

export async function create(data: CreateScrapEntryInput, userId: string): Promise<IScrapEntry> {
  const jo = await JobOrder.findById(data.jobOrderId)
  if (!jo) throw new CustomError(404, 'error.not_found')
  if (!jo.startTime) throw new CustomError(400, 'error.job_order_not_started_for_adjustment')

  if (data.amount <= 0) throw new CustomError(400, 'error.amount_not_positive')

  if (new Date(data.endTime) <= new Date(data.startTime)) {
    throw new CustomError(400, 'error.scrap_end_before_start')
  }
  if (new Date(data.startTime) < jo.startTime) {
    throw new CustomError(400, 'error.job_order_time_before_start')
  }

  const doc = await ScrapEntry.create({
    ...data,
    workCenterId: jo.workCenterId,
    productId: jo.productId,
    createdBy: userId,
  })
  emitScrapEntryCreated(doc._id.toString(), doc.jobOrderId.toString(), doc.workCenterId.toString())
  return doc
}

export async function getById(id: string): Promise<IScrapEntry> {
  const doc = await ScrapEntry.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IScrapEntry
}

export async function list(
  input: ScrapEntryListInput,
  visibleIds?: string[],
): Promise<PaginatedResult<IScrapEntry>> {
  const {
    page,
    limit,
    sort,
    search,
    startTimeFrom,
    startTimeTo,
    endTimeFrom,
    endTimeTo,
    createdAtFrom,
    createdAtTo,
    ...filters
  } = input
  const query: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query[key] = value
  }

  if (startTimeFrom || startTimeTo) {
    query.startTime = {
      ...(startTimeFrom && { $gte: startTimeFrom }),
      ...(startTimeTo && { $lte: startTimeTo }),
    }
  }
  if (endTimeFrom || endTimeTo) {
    query.endTime = {
      ...(endTimeFrom && { $gte: endTimeFrom }),
      ...(endTimeTo && { $lte: endTimeTo }),
    }
  }
  if (createdAtFrom || createdAtTo) {
    query.createdAt = {
      ...(createdAtFrom && { $gte: createdAtFrom }),
      ...(createdAtTo && { $lte: createdAtTo }),
    }
  }

  if (visibleIds) {
    query.workCenterId = query.workCenterId ? query.workCenterId : { $in: visibleIds }
  }

  return paginate(
    ScrapEntry,
    query,
    { page, limit, sort, search },
    {
      allowedSortFields: ['startTime', 'endTime', 'amount', 'createdAt', 'updatedAt'],
      searchFields: ['description'],
    },
  )
}

export async function update(
  id: string,
  data: PatchScrapEntryInput,
  userId: string,
): Promise<IScrapEntry> {
  const scrap = await ScrapEntry.findById(id)
  if (!scrap) throw new CustomError(404, 'error.not_found')

  const newStartTime = data.startTime ? new Date(data.startTime) : scrap.startTime
  const newEndTime = data.endTime ? new Date(data.endTime) : scrap.endTime

  if (newEndTime <= newStartTime) {
    throw new CustomError(400, 'error.scrap_end_before_start')
  }

  if (data.startTime) {
    const jo = await JobOrder.findById(scrap.jobOrderId)
    if (jo && jo.startTime && new Date(data.startTime) < jo.startTime) {
      throw new CustomError(400, 'error.job_order_time_before_start')
    }
  }

  const doc = await ScrapEntry.findOneAndUpdate(
    { _id: id },
    { $set: { ...data, updatedBy: userId } },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitScrapEntryUpdated(id, scrap.jobOrderId.toString(), scrap.workCenterId.toString())
  return doc
}

export async function remove(id: string): Promise<IScrapEntry> {
  const doc = await ScrapEntry.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitScrapEntryDeleted(id, doc.jobOrderId.toString(), doc.workCenterId.toString())
  return doc
}
