import { CustomError } from '@mes/core'
import { emitProductCreated, emitProductDeleted, emitProductUpdated } from '../../jobs/events.js'
import { type PaginatedResult, paginate } from '../../utils/pagination.js'
import { ProductCategory } from '../product-category/product-category.model.js'
import { Uom } from '../uom/uom.model.js'
import { type IProduct, Product } from './product.model.js'
import type {
  CreateProductInput,
  PatchProductInput,
  ProductListInput,
} from './product.validators.js'

async function validateRefs(data: { uomId?: string; categoryId?: string | null }): Promise<void> {
  if (data.uomId) {
    const uom = await Uom.findById(data.uomId)
    if (!uom) throw new CustomError(404, 'error.not_found')
  }
  if (data.categoryId) {
    const cat = await ProductCategory.findById(data.categoryId)
    if (!cat) throw new CustomError(404, 'error.not_found')
  }
}

export async function create(data: CreateProductInput): Promise<IProduct> {
  await validateRefs(data)
  const doc = await Product.create(data)
  emitProductCreated(doc._id.toString())
  return doc
}

export async function getById(id: string): Promise<IProduct> {
  const doc = await Product.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IProduct
}

export async function list(input: ProductListInput): Promise<PaginatedResult<IProduct>> {
  const { page, limit, sort, search, ...filters } = input
  const query: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query[key] = value
  }
  return paginate(
    Product,
    query,
    { page, limit, sort, search },
    {
      allowedSortFields: ['code', 'name', 'kind', 'createdAt', 'updatedAt'],
      searchFields: ['code', 'name'],
    },
  )
}

export async function update(id: string, data: PatchProductInput): Promise<IProduct> {
  await validateRefs(data)
  const doc = await Product.findOneAndUpdate(
    { _id: id },
    { $set: data },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitProductUpdated(id)
  return doc
}

function safeCountDocuments(modelName: string, filter: Record<string, unknown>): Promise<number> {
  try {
    return mongoose.model(modelName).countDocuments(filter) as Promise<number>
  } catch {
    return Promise.resolve(0)
  }
}

export async function remove(id: string): Promise<IProduct> {
  const [standardCount, planCount, joCount] = await Promise.all([
    safeCountDocuments('ProductStandard', { productId: id }),
    safeCountDocuments('ProductionPlan', { productId: id }),
    safeCountDocuments('JobOrder', { productId: id }),
  ])
  if (standardCount + planCount + joCount > 0) {
    throw new CustomError(409, 'error.referenced')
  }

  const doc = await Product.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitProductDeleted(id)
  return doc
}

import mongoose from 'mongoose'
