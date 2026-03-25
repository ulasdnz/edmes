import { CustomError } from '@mes/core'
import mongoose from 'mongoose'
import {
  emitProductStandardCreated,
  emitProductStandardDeleted,
  emitProductStandardUpdated,
} from '../../jobs/events.js'
import { getWorkCenterInfo } from '../../lib/internal-api.js'
import { type PaginatedResult, paginate } from '../../utils/pagination.js'
import { Product } from '../product/product.model.js'
import { type IProductStandard, ProductStandard } from './product-standard.model.js'
import type {
  CreateProductStandardInput,
  PatchProductStandardInput,
  ProductStandardListInput,
} from './product-standard.validators.js'

async function validateCreateStandard(data: CreateProductStandardInput): Promise<void> {
  const product = await Product.findById(data.productId)
  if (!product) throw new CustomError(404, 'error.not_found')

  const wcInfo = await getWorkCenterInfo(data.workCenterId)
  if (!wcInfo) throw new CustomError(400, 'error.work_center_unreachable')
  if (wcInfo.type !== 'physical') throw new CustomError(400, 'error.work_center_not_physical')

  if (wcInfo.productivityMode === 'count_based' && !data.counterMultiplier) {
    throw new CustomError(400, 'error.counter_multiplier_required')
  }
  if (wcInfo.productivityMode === 'speed_based' && !data.idealSpeed) {
    throw new CustomError(400, 'error.ideal_speed_required')
  }
}

async function isApplied(standardId: string): Promise<boolean> {
  const standard = await ProductStandard.findById(standardId).lean()
  if (!standard) return false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let JobOrder: mongoose.Model<any>
  try {
    JobOrder = mongoose.model('JobOrder')
  } catch {
    return false
  }

  const jobOrders = await JobOrder.find({
    productId: standard.productId,
    workCenterId: standard.workCenterId,
    startTime: { $ne: null },
  })
    .select('startTime')
    .lean<Array<{ _id: unknown; startTime: Date }>>()

  for (const jo of jobOrders) {
    const applicable = await ProductStandard.findOne({
      productId: standard.productId,
      workCenterId: standard.workCenterId,
      validFrom: { $lte: jo.startTime },
    })
      .sort({ validFrom: -1 })
      .select('_id')
      .lean()

    if (applicable && applicable._id.toString() === standardId) return true
  }
  return false
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
  if (await isApplied(id)) throw new CustomError(409, 'error.product_standard_applied')

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
    } catch {
      // JobOrder model not registered yet
    }
    if (joCount > 0) throw new CustomError(409, 'error.product_standard_last_revision')
  }

  const doc = await ProductStandard.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitProductStandardDeleted(id)
  return doc
}
