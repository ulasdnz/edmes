import type { Model, PopulateOptions, QueryFilter } from 'mongoose'
import { z } from 'zod'

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  search: z.string().trim().max(100).optional(),
})

export type PaginationInput = z.infer<typeof paginationSchema>

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PaginatedResult<T> {
  data: T[]
  pagination: PaginationMeta
}

interface PaginateOptions {
  defaultSort?: Record<string, 1 | -1>
  allowedSortFields?: string[]
  select?: string | Record<string, number>
  populate?: string | PopulateOptions | (string | PopulateOptions)[]
  // Case-insensitive search anywhere in these fields. No index can serve it, so it suits small
  // collections only.
  searchFields?: string[]
  // A unique code field. The search matches it by prefix through its index, read the way a code is
  // stored (trimmed, upper case), and returns matches in code order.
  codeField?: string
}

export async function paginate<T>(
  model: Model<T>,
  filters: Record<string, unknown>,
  input: PaginationInput,
  options: PaginateOptions = {},
): Promise<PaginatedResult<T>> {
  const { page, limit, search } = input
  const { codeField } = options
  const skip = (page - 1) * limit
  const codePrefix = codeField && search ? escapeRegex(search.trim().toUpperCase()) : ''
  const sort = parseSort(
    input.sort,
    codeField && codePrefix ? { [codeField]: 1 } : options.defaultSort,
    options.allowedSortFields,
    codeField,
  )

  const query: Record<string, unknown> = { ...filters }
  if (codeField && codePrefix) {
    query[codeField] = { $regex: `^${codePrefix}` }
  } else if (search && options.searchFields?.length) {
    const escaped = escapeRegex(search)
    query.$or = options.searchFields.map(field => ({
      [field]: { $regex: escaped, $options: 'i' },
    }))
  }

  let dataQuery = model
    .find(query as QueryFilter<T>)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .select('-__v')
    .lean()
  if (options.select) dataQuery = dataQuery.select(options.select) as typeof dataQuery
  if (options.populate) {
    dataQuery = dataQuery.populate(
      options.populate as PopulateOptions | (string | PopulateOptions)[],
    ) as typeof dataQuery
  }

  const [data, total] = await Promise.all([
    dataQuery.exec() as Promise<T[]>,
    model.countDocuments(query as QueryFilter<T>).exec(),
  ])

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  }
}

function parseSort(
  input?: string,
  defaultSort?: Record<string, 1 | -1>,
  allowedFields?: string[],
  uniqueField?: string,
): Record<string, 1 | -1> {
  const result: Record<string, 1 | -1> = {}
  for (const segment of (input ?? '').split(',')) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    const descending = trimmed.startsWith('-')
    const field = descending ? trimmed.slice(1) : trimmed
    if (!field) continue
    if (allowedFields && !allowedFields.includes(field)) continue

    result[field] = descending ? -1 : 1
  }

  const sort = Object.keys(result).length > 0 ? result : { ...(defaultSort ?? { createdAt: -1 }) }
  // Documents with equal sort values come back in no fixed order, and that order changes with
  // skip and limit, so pages would repeat some documents and skip others. _id is unique, so it
  // makes the order total. A unique field already does, and _id after it would keep the field's
  // index from serving the sort.
  if (!('_id' in sort) && !(uniqueField && uniqueField in sort)) {
    sort._id = Object.values(sort).at(-1) ?? -1
  }
  return sort
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
