import { CustomError } from '@mes/core'
import mongoose from 'mongoose'
import {
  emitProductionPlanCreated,
  emitProductionPlanDeleted,
  emitProductionPlanUpdated,
} from '../../jobs/events.js'
import { type PaginatedResult, paginate } from '../../utils/pagination.js'
import { Product } from '../product/product.model.js'
import { type IProductionPlan, ProductionPlan } from './production-plan.model.js'
import type {
  CreateProductionPlanInput,
  PatchProductionPlanInput,
  ProductionPlanListInput,
} from './production-plan.validators.js'

function getJobOrderModel(): mongoose.Model<any> | null {
  try {
    return mongoose.model('JobOrder')
  } catch {
    return null
  }
}

async function hasChildren(planId: string): Promise<boolean> {
  const JobOrder = getJobOrderModel()
  if (!JobOrder) return false
  return (await JobOrder.countDocuments({ productionPlanId: planId })) > 0
}

export async function getChildTargetSum(
  planId: string,
  excludeJobOrderId?: string,
): Promise<number> {
  const JobOrder = getJobOrderModel()
  if (!JobOrder) return 0
  const match: Record<string, unknown> = { productionPlanId: new mongoose.Types.ObjectId(planId) }
  if (excludeJobOrderId) match._id = { $ne: new mongoose.Types.ObjectId(excludeJobOrderId) }
  const result = await JobOrder.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$targetQuantity' } } },
  ])
  return result[0]?.total ?? 0
}

export async function create(
  data: CreateProductionPlanInput,
  userId: string,
): Promise<IProductionPlan> {
  const product = await Product.findById(data.productId)
  if (!product) throw new CustomError(404, 'error.not_found')

  const doc = await ProductionPlan.create({ ...data, createdBy: userId })
  emitProductionPlanCreated(doc._id.toString())
  return doc
}

export async function getById(id: string): Promise<IProductionPlan> {
  const doc = await ProductionPlan.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IProductionPlan
}

export async function list(
  input: ProductionPlanListInput,
): Promise<PaginatedResult<IProductionPlan>> {
  const { page, limit, sort, search, dueAtFrom, dueAtTo, createdAtFrom, createdAtTo, ...filters } =
    input
  const query: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query[key] = value
  }

  if (dueAtFrom || dueAtTo) {
    query.dueAt = {
      ...(dueAtFrom && { $gte: dueAtFrom }),
      ...(dueAtTo && { $lte: dueAtTo }),
    }
  }
  if (createdAtFrom || createdAtTo) {
    query.createdAt = {
      ...(createdAtFrom && { $gte: createdAtFrom }),
      ...(createdAtTo && { $lte: createdAtTo }),
    }
  }

  return paginate(
    ProductionPlan,
    query,
    { page, limit, sort, search },
    {
      allowedSortFields: ['code', 'targetQuantity', 'dueAt', 'createdAt', 'updatedAt'],
      searchFields: ['code', 'description'],
    },
  )
}

export async function update(
  id: string,
  data: PatchProductionPlanInput,
  userId: string,
): Promise<IProductionPlan> {
  const plan = await ProductionPlan.findById(id)
  if (!plan) throw new CustomError(404, 'error.not_found')

  const hasKids = await hasChildren(id)

  if (data.productId && hasKids) throw new CustomError(409, 'error.plan_immutable_field')
  if (data.code && hasKids) throw new CustomError(409, 'error.plan_immutable_field')

  if (data.targetQuantity !== undefined) {
    const childSum = await getChildTargetSum(id)
    if (data.targetQuantity < childSum) throw new CustomError(409, 'error.plan_target_exceeded')
  }

  if (data.productId) {
    const product = await Product.findById(data.productId)
    if (!product) throw new CustomError(404, 'error.not_found')
  }

  const doc = await ProductionPlan.findOneAndUpdate(
    { _id: id },
    { $set: { ...data, updatedBy: userId } },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitProductionPlanUpdated(id)
  return doc
}

export async function remove(id: string): Promise<IProductionPlan> {
  if (await hasChildren(id)) throw new CustomError(409, 'error.referenced')

  const doc = await ProductionPlan.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitProductionPlanDeleted(id)
  return doc
}
