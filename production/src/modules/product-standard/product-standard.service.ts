import { CustomError } from '@mes/core'
import { type PaginatedResult, paginate } from '@mes/core/pagination'
import mongoose from 'mongoose'
import {
  emitProductStandardCreated,
  emitProductStandardDeleted,
  emitProductStandardUpdated,
} from '../../jobs/events.js'
import { getWorkCenterInfo } from '../../lib/internal-api.js'
import { logger } from '../../lib/logger.js'
import { Product } from '../product/product.model.js'
import { type IProductStandard, ProductStandard } from './product-standard.model.js'
import type {
  CreateProductStandardInput,
  PatchProductStandardInput,
  ProductStandardListInput,
  TimelinesBatchInput,
} from './product-standard.validators.js'

type AppliedJobOrder = {
  _id: mongoose.Types.ObjectId
  productId: mongoose.Types.ObjectId
  workCenterId: mongoose.Types.ObjectId
  startTime: Date | null
  endTime: Date | null
}
type AppliedJobOrderModel = mongoose.Model<AppliedJobOrder>

// Single source of truth for ProductStandard <-> WorkCenter productivityMode invariants.
// Both create and update call this with the post-mutation effective values so a patch
// cannot leave a record in an invalid state for the work center's mode.
async function assertProductivityModeRequirements(
  workCenterId: string,
  effective: { counterMultiplier?: number | null; idealSpeed?: number | null },
): Promise<void> {
  const wcInfo = await getWorkCenterInfo(workCenterId)
  if (!wcInfo) throw new CustomError(400, 'error.work_center_unreachable')
  if (wcInfo.type !== 'physical') throw new CustomError(400, 'error.work_center_not_physical')

  if (wcInfo.productivityMode === 'count_based' && !effective.counterMultiplier) {
    throw new CustomError(400, 'error.counter_multiplier_required')
  }
  if (wcInfo.productivityMode === 'speed_based' && !effective.idealSpeed) {
    throw new CustomError(400, 'error.ideal_speed_required')
  }
}

async function validateCreateStandard(data: CreateProductStandardInput): Promise<void> {
  const product = await Product.findById(data.productId)
  if (!product) throw new CustomError(404, 'error.not_found')

  await assertProductivityModeRequirements(data.workCenterId, {
    counterMultiplier: data.counterMultiplier,
    idealSpeed: data.idealSpeed,
  })
}

// A standard is applied once a started job order has run under it: the job order's run so far
// overlaps the standard's validity [validFrom, next validFrom). That includes a standard that
// took effect in the middle of a running job order, which converted part of its output.
async function isApplied(standardId: string): Promise<boolean> {
  const standard = await ProductStandard.findById(standardId).lean()
  if (!standard || standard.validFrom > new Date()) return false

  let JobOrder: AppliedJobOrderModel
  try {
    JobOrder = mongoose.model('JobOrder') as unknown as AppliedJobOrderModel
  } catch (err) {
    logger.error('JobOrder model not registered during isApplied check', {
      event: 'product_standard.model_not_registered',
      standardId,
      error: err instanceof Error ? err.message : err,
    })
    return false
  }

  const next = await ProductStandard.findOne({
    productId: standard.productId,
    workCenterId: standard.workCenterId,
    validFrom: { $gt: standard.validFrom },
  })
    .sort({ validFrom: 1 })
    .select('validFrom')
    .lean()

  const ranUnderIt = await JobOrder.exists({
    productId: standard.productId,
    workCenterId: standard.workCenterId,
    startTime: next ? { $lt: next.validFrom } : { $ne: null },
    $or: [{ endTime: null }, { endTime: { $gt: standard.validFrom } }],
  })
  return ranUnderIt !== null
}

export async function create(
  data: CreateProductStandardInput,
  userId: string,
): Promise<IProductStandard> {
  await validateCreateStandard(data)
  const doc = await ProductStandard.create({
    ...data,
    validFrom: data.validFrom ?? new Date(),
    createdBy: userId,
  })
  emitProductStandardCreated(doc._id.toString())
  return doc
}

export async function getById(id: string): Promise<IProductStandard> {
  const doc = await ProductStandard.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IProductStandard
}

export async function list(
  input: ProductStandardListInput,
  visibleIds?: string[],
): Promise<PaginatedResult<IProductStandard>> {
  const { page, limit, sort, validFromFrom, validFromTo, createdAtFrom, createdAtTo, ...filters } =
    input
  const query: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query[key] = value
  }

  if (validFromFrom || validFromTo) {
    query.validFrom = {
      ...(validFromFrom && { $gte: validFromFrom }),
      ...(validFromTo && { $lte: validFromTo }),
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
    ProductStandard,
    query,
    { page, limit, sort },
    {
      allowedSortFields: ['validFrom', 'idealOutputPerMinute', 'createdAt', 'updatedAt'],
    },
  )
}

export async function update(
  id: string,
  data: PatchProductStandardInput,
  userId: string,
): Promise<IProductStandard> {
  const current = await ProductStandard.findById(id).lean()
  if (!current) throw new CustomError(404, 'error.not_found')
  if (await isApplied(id)) throw new CustomError(409, 'error.product_standard_applied')

  // Validate the post-patch effective state, not just the patch fields. A null in
  // `data` means "explicitly null"; `undefined` means "leave existing value".
  const effective = {
    counterMultiplier:
      data.counterMultiplier !== undefined ? data.counterMultiplier : current.counterMultiplier,
    idealSpeed: data.idealSpeed !== undefined ? data.idealSpeed : current.idealSpeed,
  }
  await assertProductivityModeRequirements(current.workCenterId.toString(), effective)

  const doc = await ProductStandard.findOneAndUpdate(
    { _id: id },
    { $set: { ...data, updatedBy: userId } },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitProductStandardUpdated(id)
  return doc
}

export async function remove(id: string): Promise<IProductStandard> {
  if (await isApplied(id)) throw new CustomError(409, 'error.product_standard_applied')

  const standard = await ProductStandard.findById(id)
  if (!standard) throw new CustomError(404, 'error.not_found')

  const revisionCount = await ProductStandard.countDocuments({
    productId: standard.productId,
    workCenterId: standard.workCenterId,
  })

  if (revisionCount <= 1) {
    let joCount = 0
    try {
      const JobOrder = mongoose.model('JobOrder')
      joCount = await JobOrder.countDocuments({
        productId: standard.productId,
        workCenterId: standard.workCenterId,
      })
    } catch (err) {
      logger.error('JobOrder model not registered during delete check', {
        event: 'product_standard.model_not_registered',
        standardId: id,
        error: err instanceof Error ? err.message : err,
      })
    }
    if (joCount > 0) throw new CustomError(409, 'error.product_standard_last_revision')
  }

  const doc = await ProductStandard.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitProductStandardDeleted(id)
  return doc
}

export interface TimelineStandardProjection {
  _id: string
  productId: string
  workCenterId: string
  validFrom: Date
  idealOutputPerMinute: number
  counterMultiplier: number | null
  idealSpeed: number | null
}

export interface TimelineResultItem {
  jobOrderId: string
  standards: TimelineStandardProjection[]
  qualityFlags: string[]
}

export async function findTimelinesBatch(
  input: TimelinesBatchInput,
): Promise<{ items: TimelineResultItem[] }> {
  const { items } = input
  if (items.length === 0) return { items: [] }

  const groups = new Map<
    string,
    {
      productId: string
      workCenterId: string
      maxTo: Date
      minFrom: Date
      itemIndexes: number[]
    }
  >()

  items.forEach((item, idx) => {
    const key = `${item.productId}:${item.workCenterId}`
    const existing = groups.get(key)
    if (existing) {
      if (item.to.getTime() > existing.maxTo.getTime()) existing.maxTo = item.to
      if (item.from.getTime() < existing.minFrom.getTime()) existing.minFrom = item.from
      existing.itemIndexes.push(idx)
    } else {
      groups.set(key, {
        productId: item.productId,
        workCenterId: item.workCenterId,
        maxTo: item.to,
        minFrom: item.from,
        itemIndexes: [idx],
      })
    }
  })

  type StandardDoc = {
    _id: mongoose.Types.ObjectId
    productId: mongoose.Types.ObjectId
    workCenterId: mongoose.Types.ObjectId
    validFrom: Date
    idealOutputPerMinute: number
    counterMultiplier: number | null
    idealSpeed: number | null
  }

  const standardsByGroup = new Map<string, StandardDoc[]>()
  const projection =
    '_id productId workCenterId validFrom idealOutputPerMinute counterMultiplier idealSpeed'

  await Promise.all(
    Array.from(groups.entries()).map(async ([key, group]) => {
      const [groupBaseline, groupRevisions] = await Promise.all([
        ProductStandard.findOne({
          productId: group.productId,
          workCenterId: group.workCenterId,
          validFrom: { $lte: group.minFrom },
        })
          .sort({ validFrom: -1 })
          .select(projection)
          .lean<StandardDoc>(),
        ProductStandard.find({
          productId: group.productId,
          workCenterId: group.workCenterId,
          validFrom: { $gt: group.minFrom, $lte: group.maxTo },
        })
          .sort({ validFrom: 1 })
          .select(projection)
          .lean<StandardDoc[]>(),
      ])
      standardsByGroup.set(key, groupBaseline ? [groupBaseline, ...groupRevisions] : groupRevisions)
    }),
  )

  const results: TimelineResultItem[] = items.map(item => {
    const key = `${item.productId}:${item.workCenterId}`
    const groupStandards = standardsByGroup.get(key) ?? []

    let baseline: StandardDoc | null = null
    const revisions: StandardDoc[] = []

    for (const std of groupStandards) {
      if (std.validFrom.getTime() <= item.from.getTime()) {
        if (!baseline || std.validFrom.getTime() > baseline.validFrom.getTime()) {
          baseline = std
        }
      } else if (
        std.validFrom.getTime() > item.from.getTime() &&
        std.validFrom.getTime() <= item.to.getTime()
      ) {
        revisions.push(std)
      }
    }

    revisions.sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime())

    const ordered: StandardDoc[] = baseline ? [baseline, ...revisions] : revisions
    const qualityFlags = baseline ? [] : ['no_standard_for_interval']

    return {
      jobOrderId: item.jobOrderId,
      standards: ordered.map(std => ({
        _id: std._id.toString(),
        productId: std.productId.toString(),
        workCenterId: std.workCenterId.toString(),
        validFrom: std.validFrom,
        idealOutputPerMinute: std.idealOutputPerMinute,
        counterMultiplier: std.counterMultiplier,
        idealSpeed: std.idealSpeed,
      })),
      qualityFlags,
    }
  })

  return { items: results }
}
