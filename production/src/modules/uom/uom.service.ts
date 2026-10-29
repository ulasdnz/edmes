import { CustomError } from '@mes/core'
import { type PaginatedResult, paginate } from '@mes/core/pagination'
import { emitUomCreated, emitUomDeleted, emitUomUpdated } from '../../jobs/events.js'
import { Product } from '../product/product.model.js'
import { type IUom, Uom } from './uom.model.js'
import type { CreateUomInput, PatchUomInput, UomListInput } from './uom.validators.js'

export async function create(data: CreateUomInput): Promise<IUom> {
  const doc = await Uom.create(data)
  emitUomCreated(doc._id.toString())
  return doc
}

export async function getById(id: string): Promise<IUom> {
  const doc = await Uom.findById(id).lean().select('-__v')
  if (!doc) throw new CustomError(404, 'error.not_found')
  return doc as IUom
}

export async function list(input: UomListInput): Promise<PaginatedResult<IUom>> {
  const { page, limit, sort, search, ...filters } = input
  const query: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query[key] = value
  }
  return paginate(
    Uom,
    query,
    { page, limit, sort, search },
    {
      allowedSortFields: ['code', 'name', 'symbol', 'createdAt', 'updatedAt'],
      searchFields: ['code', 'name', 'symbol'],
    },
  )
}

export async function update(id: string, data: PatchUomInput): Promise<IUom> {
  const doc = await Uom.findOneAndUpdate(
    { _id: id },
    { $set: data },
    { returnDocument: 'after', runValidators: true },
  )
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitUomUpdated(id)
  return doc
}

export async function remove(id: string): Promise<IUom> {
  const referenced = await Product.countDocuments({ uomId: id })
  if (referenced > 0) throw new CustomError(409, 'error.referenced')

  const doc = await Uom.findOneAndDelete({ _id: id })
  if (!doc) throw new CustomError(404, 'error.not_found')
  emitUomDeleted(id)
  return doc
}
