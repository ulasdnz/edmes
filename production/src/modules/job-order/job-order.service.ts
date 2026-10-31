import { CustomError } from '@mes/core'
import { type PaginatedResult, paginate } from '@mes/core/pagination'
import {
  emitJobOrderCreated,
  emitJobOrderDeleted,
  emitJobOrderEnded,
  emitJobOrderStarted,
  emitJobOrderUpdated,
} from '../../jobs/events.js'
import { getWorkCenterInfo } from '../../lib/internal-api.js'
import { logger } from '../../lib/logger.js'
import { limitToVisibleWorkCenters } from '../../utils/visibility.js'
import { Product } from '../product/product.model.js'
import { ProductStandard } from '../product-standard/product-standard.model.js'
import { ProductionPlan } from '../production-plan/production-plan.model.js'
import { getChildTargetSum } from '../production-plan/production-plan.service.js'
import { type IJobOrder, JobOrder } from './job-order.model.js'
import type {
  CreateJobOrderInput,
  EndJobOrderInput,
  JobOrderListInput,
  PatchJobOrderInput,
  StartJobOrderInput,
} from './job-order.validators.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeCountDocuments(modelName: string, filter: Record<string, unknown>): Promise<number> {
  try {
    const mongoose = require('mongoose')
    return mongoose.model(modelName).countDocuments(filter) as Promise<number>
  } catch (err) {
    logger.error(`Reference check failed: model "${modelName}" not registered`, {
      event: 'job_order.reference_check_failed',
      modelName,
      error: err instanceof Error ? err.message : err,
    })
    return Promise.resolve(0)
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000
}

async function validateParentChildConstraints(
  productionPlanId: string,
  productId: string,
  targetQuantity: number,
  excludeJobOrderId?: string,
): Promise<void> {
  const plan = await ProductionPlan.findById(productionPlanId)
  if (!plan) throw new CustomError(404, 'error.not_found')
  if (plan.productId.toString() !== productId) {
    throw new CustomError(400, 'error.plan_product_mismatch')
  }
  const childSum = await getChildTargetSum(productionPlanId, excludeJobOrderId)
  if (childSum + targetQuantity > plan.targetQuantity) {
    throw new CustomError(409, 'error.plan_target_exceeded')
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function create(data: CreateJobOrderInput, userId: string): Promise<IJobOrder> {
  const product = await Product.findById(data.productId)
  if (!product) throw new CustomError(404, 'error.not_found')

  const wcInfo = await getWorkCenterInfo(data.workCenterId)
  if (!wcInfo) throw new CustomError(400, 'error.work_center_unreachable')
  if (wcInfo.type !== 'physical') throw new CustomError(400, 'error.work_center_not_physical')

  const standardExists = await ProductStandard.findOne({
    productId: data.productId,
    workCenterId: data.workCenterId,
    validFrom: { $lte: new Date() },
  })
  if (!standardExists) throw new CustomError(400, 'error.job_order_no_standard')

  if (data.productionPlanId) {
    await validateParentChildConstraints(data.productionPlanId, data.productId, data.targetQuantity)
  }

  const doc = await JobOrder.create({
    ...data,
    startTime: null,
    endTime: null,
    startedBy: null,
    endedBy: null,
    createdBy: userId,
  })
  emitJobOrderCreated(doc._id.toString(), data.workCenterId)
  return doc
}

export async function getById(id: string): Promise<IJobOrder> {
  const doc = await JobOrder.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IJobOrder
}

export async function list(
  input: JobOrderListInput,
  visibleIds?: string[],
): Promise<PaginatedResult<IJobOrder>> {
  const query = buildJobOrderFilters(input, visibleIds)
  const { page, limit, sort, search } = input

  return paginate(
    JobOrder,
    query,
    { page, limit, sort, search },
    {
      // Only orders an index serves; any other sorts the whole history in memory
      allowedSortFields: ['createdAt', 'code'],
      codeField: 'code',
    },
  )
}

export async function update(
  id: string,
  data: PatchJobOrderInput,
  userId: string,
): Promise<IJobOrder> {
  const jo = await JobOrder.findById(id)
  if (!jo) throw new CustomError(404, 'error.not_found')

  const isStarted = jo.startTime !== null

  if (isStarted) {
    const forbidden = [
      'code',
      'productId',
      'workCenterId',
      'productionPlanId',
      'targetQuantity',
      'plannedStartAt',
    ]
    for (const f of forbidden) {
      if ((data as Record<string, unknown>)[f] !== undefined) {
        throw new CustomError(409, 'error.immutable_field')
      }
    }
  } else {
    if (data.productionPlanId !== undefined || data.targetQuantity !== undefined) {
      const planId = data.productionPlanId ?? jo.productionPlanId?.toString() ?? null
      const productId = data.productId ?? jo.productId.toString()
      const qty = data.targetQuantity ?? jo.targetQuantity

      if (planId) {
        await validateParentChildConstraints(planId, productId, qty, id)
      }
    }

    if (data.productId) {
      const product = await Product.findById(data.productId)
      if (!product) throw new CustomError(404, 'error.not_found')
    }

    if (data.workCenterId) {
      const wcInfo = await getWorkCenterInfo(data.workCenterId)
      if (!wcInfo) throw new CustomError(400, 'error.work_center_unreachable')
      if (wcInfo.type !== 'physical') throw new CustomError(400, 'error.work_center_not_physical')
    }
  }

  const doc = await JobOrder.findOneAndUpdate(
    { _id: id },
    { $set: { ...data, updatedBy: userId } },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  const previousWorkCenterId =
    data.workCenterId && data.workCenterId !== jo.workCenterId.toString()
      ? jo.workCenterId.toString()
      : undefined
  emitJobOrderUpdated(id, doc.workCenterId.toString(), previousWorkCenterId)
  return doc
}

export async function remove(id: string): Promise<IJobOrder> {
  const jo = await JobOrder.findById(id)
  if (!jo) throw new CustomError(404, 'error.not_found')

  if (jo.startTime !== null) throw new CustomError(409, 'error.job_order_started_no_delete')

  const [qaCount, scrapCount] = await Promise.all([
    safeCountDocuments('QuantityAdjustment', { jobOrderId: id }),
    safeCountDocuments('ScrapEntry', { jobOrderId: id }),
  ])
  if (qaCount + scrapCount > 0) throw new CustomError(409, 'error.referenced')

  const doc = await JobOrder.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitJobOrderDeleted(id, doc.workCenterId.toString())
  return doc
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function start(
  id: string,
  body: StartJobOrderInput,
  userId: string,
  visibleIds?: string[],
): Promise<IJobOrder> {
  const jo = await JobOrder.findById(id)
  if (!jo) throw new CustomError(404, 'error.not_found')

  if (visibleIds && !visibleIds.includes(jo.workCenterId.toString())) {
    throw new CustomError(404, 'error.not_found')
  }

  if (jo.startTime) throw new CustomError(409, 'error.job_order_already_started')

  const actualStart = body.startTime ? new Date(body.startTime) : new Date()

  if (actualStart > new Date()) throw new CustomError(400, 'error.job_order_start_future')

  const activeJo = await JobOrder.findOne({
    workCenterId: jo.workCenterId,
    startTime: { $ne: null },
    endTime: null,
    _id: { $ne: jo._id },
  })
  if (activeJo) throw new CustomError(409, 'error.job_order_active_exists')

  const overlapping = await JobOrder.findOne({
    workCenterId: jo.workCenterId,
    _id: { $ne: jo._id },
    startTime: { $ne: null },
    $or: [{ endTime: null }, { endTime: { $gt: actualStart } }],
  })
  if (overlapping) throw new CustomError(409, 'error.job_order_overlap')

  const standard = await ProductStandard.findOne({
    productId: jo.productId,
    workCenterId: jo.workCenterId,
    validFrom: { $lte: actualStart },
  }).sort({ validFrom: -1 })
  if (!standard) throw new CustomError(400, 'error.job_order_no_standard')

  // Two requests can both pass the checks above. The filter starts this order once, and the unique
  // index on running orders keeps a second one off the work center.
  let updated: IJobOrder | null
  try {
    updated = await JobOrder.findOneAndUpdate(
      { _id: id, startTime: null },
      { $set: { startTime: actualStart, startedBy: userId, updatedBy: userId } },
      { returnDocument: 'after', runValidators: true },
    )
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new CustomError(409, 'error.job_order_active_exists')
    throw err
  }
  if (!updated) throw new CustomError(409, 'error.job_order_already_started')
  emitJobOrderStarted(id, jo.workCenterId.toString())
  return updated
}

export async function end(
  id: string,
  body: EndJobOrderInput,
  userId: string,
  visibleIds?: string[],
): Promise<IJobOrder> {
  const jo = await JobOrder.findById(id)
  if (!jo) throw new CustomError(404, 'error.not_found')

  if (visibleIds && !visibleIds.includes(jo.workCenterId.toString())) {
    throw new CustomError(404, 'error.not_found')
  }

  if (!jo.startTime) throw new CustomError(409, 'error.job_order_not_started')
  if (jo.endTime) throw new CustomError(409, 'error.job_order_already_ended')

  const actualEnd = body.endTime ? new Date(body.endTime) : new Date()

  if (actualEnd > new Date()) throw new CustomError(400, 'error.job_order_end_future')
  if (actualEnd < jo.startTime) throw new CustomError(400, 'error.job_order_end_before_start')

  const overlapping = await JobOrder.findOne({
    workCenterId: jo.workCenterId,
    _id: { $ne: jo._id },
    startTime: { $ne: null, $lt: actualEnd },
    $or: [{ endTime: null }, { endTime: { $gt: jo.startTime } }],
  })
  if (overlapping) throw new CustomError(409, 'error.job_order_overlap')

  const updated = await JobOrder.findOneAndUpdate(
    { _id: id },
    { $set: { endTime: actualEnd, endedBy: userId, updatedBy: userId } },
    { returnDocument: 'after', runValidators: true },
  )
  if (!updated) throw new CustomError(404, 'error.not_found')
  emitJobOrderEnded(id, jo.workCenterId.toString())
  return updated
}

// ── Advanced Filters ────────────────────────────────────────────────────────

function buildDateRange(
  query: Record<string, unknown>,
  field: string,
  from?: Date,
  to?: Date,
): void {
  if (from || to) {
    query[field] = {
      ...(from && { $gte: from }),
      ...(to && { $lte: to }),
    }
  }
}

function buildJobOrderFilters(
  input: JobOrderListInput,
  visibleIds?: string[],
): Record<string, unknown> {
  const query: Record<string, unknown> = {}

  const simpleKeys = [
    '_id',
    'code',
    'productionPlanId',
    'workCenterId',
    'productId',
    'createdBy',
    'startedBy',
    'endedBy',
  ] as const
  for (const key of simpleKeys) {
    if (input[key] !== undefined) query[key] = input[key]
  }

  if (input.workCenterIds) query.workCenterId = { $in: input.workCenterIds.split(',') }
  if (input.productIds) query.productId = { $in: input.productIds.split(',') }

  if (input.runtimeState === 'pending') query.startTime = null
  if (input.runtimeState === 'running') {
    query.startTime = { $ne: null }
    query.endTime = null
  }
  if (input.runtimeState === 'finished') {
    query.startTime = { $ne: null }
    query.endTime = { $ne: null }
  }

  buildDateRange(query, 'plannedStartAt', input.plannedStartAtFrom, input.plannedStartAtTo)
  buildDateRange(query, 'startTime', input.startTimeFrom, input.startTimeTo)
  buildDateRange(query, 'endTime', input.endTimeFrom, input.endTimeTo)
  buildDateRange(query, 'dueAt', input.dueAtFrom, input.dueAtTo)
  buildDateRange(query, 'createdAt', input.createdAtFrom, input.createdAtTo)

  if (input.activeFrom || input.activeTo) {
    query.startTime = { $ne: null }
    if (input.activeFrom && input.activeTo) {
      query.$and = [
        { $or: [{ endTime: null }, { endTime: { $gt: input.activeFrom } }] },
        { startTime: { $lt: input.activeTo } },
      ]
    } else if (input.activeFrom) {
      query.$or = [{ endTime: null }, { endTime: { $gt: input.activeFrom } }]
    } else if (input.activeTo) {
      query.startTime = { ...(query.startTime as object), $lt: input.activeTo }
    }
  }

  // Last, so that no filter above can replace it
  limitToVisibleWorkCenters(query, visibleIds)
  return query
}
