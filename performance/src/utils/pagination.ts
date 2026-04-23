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
  searchFields?: string[]
}

export async function paginate<T>(
  model: Model<T>,
  filters: Record<string, unknown>,
  input: PaginationInput,
  options: PaginateOptions = {},
): Promise<PaginatedResult<T>> {
  const { page, limit, search } = input
  const skip = (page - 1) * limit
  const sort = parseSort(input.sort, options.defaultSort, options.allowedSortFields)

  const query: Record<string, unknown> = { ...filters }
  if (search && options.searchFields?.length) {
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
): Record<string, 1 | -1> {
  if (!input) return defaultSort ?? { createdAt: -1 }

  const result: Record<string, 1 | -1> = {}
  for (const segment of input.split(',')) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    const descending = trimmed.startsWith('-')
    const field = descending ? trimmed.slice(1) : trimmed
    if (!field) continue
    if (allowedFields && !allowedFields.includes(field)) continue

    result[field] = descending ? -1 : 1
  }

  return Object.keys(result).length > 0 ? result : (defaultSort ?? { createdAt: -1 })
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
