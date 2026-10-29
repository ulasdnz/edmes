import { CustomError } from '@mes/core'
import { type PaginatedResult, paginate } from '@mes/core/pagination'
import {
  emitProductCategoryCreated,
  emitProductCategoryDeleted,
  emitProductCategoryUpdated,
} from '../../jobs/events.js'
import { Product } from '../product/product.model.js'
import { type IProductCategory, ProductCategory } from './product-category.model.js'
import type {
  CreateProductCategoryInput,
  PatchProductCategoryInput,
  ProductCategoryListInput,
} from './product-category.validators.js'

export async function create(data: CreateProductCategoryInput): Promise<IProductCategory> {
  const doc = await ProductCategory.create(data)
  emitProductCategoryCreated(doc._id.toString())
  return doc
}

export async function getById(id: string): Promise<IProductCategory> {
  const doc = await ProductCategory.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IProductCategory
}

export async function list(
  input: ProductCategoryListInput,
): Promise<PaginatedResult<IProductCategory>> {
  const { page, limit, sort, search, ...filters } = input
  const query: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query[key] = value
  }
  return paginate(
    ProductCategory,
    query,
    { page, limit, sort, search },
    {
      allowedSortFields: ['code', 'name', 'createdAt', 'updatedAt'],
      searchFields: ['code', 'name'],
    },
  )
}

export async function update(
  id: string,
  data: PatchProductCategoryInput,
): Promise<IProductCategory> {
  const doc = await ProductCategory.findOneAndUpdate(
    { _id: id },
    { $set: data },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitProductCategoryUpdated(id)
  return doc
}

export async function remove(id: string): Promise<IProductCategory> {
  const referenced = await Product.countDocuments({ categoryId: id })
  if (referenced > 0) throw new CustomError(409, 'error.referenced')

  const doc = await ProductCategory.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitProductCategoryDeleted(id)
  return doc
}
