/**
 * Pagination Utility
 *
 * Modern TypeScript port of legacy pagination-helper.js patterns.
 *
 * Supported features:
 *   - returnType: 'data' | 'meta' | 'full'
 *   - hasMore via limit+1 trick (avoids count query)
 *   - groupBy via MongoDB aggregation pipeline
 *   - Timing metrics (executionTimeMs, databaseQueryTimeMs)
 *   - Type-safe Zod-validated params
 */

import type { QueryFilter, Model, PipelineStage, PopulateOptions } from 'mongoose'
import { z } from 'zod'

// ─── Types ──────────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
  sort: z.record(z.string(), z.enum(['-1', '1', 'asc', 'desc'])).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  groupBy: z.array(z.string()).optional(),
  returnType: z.enum(['data', 'meta', 'full']).default('data'),
})

export type PaginationInput = z.infer<typeof paginationSchema>

export interface PaginationMeta {
  page: number
  limit: number
  total: number | null
  totalPages: number | null
  hasMore: boolean
}

export interface PaginationInfo {
  executionTimeMs: number
  databaseQueryTimeMs: number
}

export interface PaginationResult<T> {
  data: T[]
  pagination: PaginationMeta
  info: PaginationInfo
}

interface PaginateOptions {
  defaultSort?: Record<string, 1 | -1>
  maxLimit?: number
  select?: string | Record<string, number>
  populate?: string | PopulateOptions | (string | PopulateOptions)[]
}

// ─── Core ───────────────────────────────────────────────────────────────────

/**
 * Paginate a Mongoose model with support for filtering, sorting,
 * grouping, and three return modes.
 *
 * @example
 * ```ts
 * // Simple data-only (hasMore, no count query)
 * const result = await paginate(User, { page: 1, limit: 20, returnType: 'data' });
 *
 * // Full mode (data + total count)
 * const result = await paginate(User, {
 *   page: 1,
 *   limit: 20,
 *   returnType: 'full',
 *   filters: { active: true },
 *   sort: { createdAt: '-1' },
 * });
 *
 * // Meta only (count, no data)
 * const result = await paginate(User, { returnType: 'meta', filters: { active: true } });
 * ```
 */
export const paginate = async <T>(
  model: Model<T>,
  input: PaginationInput,
  options: PaginateOptions = {},
): Promise<PaginationResult<T>> => {
  const startTime = performance.now()

  const { page, limit, returnType } = input
  const skip = (page - 1) * limit
  const sort = normalizeSort(input.sort, options.defaultSort)
  const filters = (input.filters ?? {}) as QueryFilter<T>
  const hasGroupBy = input.groupBy && input.groupBy.length > 0

  if (hasGroupBy) {
    return executeGrouped(model, {
      filters,
      groupBy: input.groupBy!,
      sort,
      skip,
      limit,
      page,
      returnType,
      startTime,
    })
  }

  return executeNormal(model, {
    filters,
    sort,
    skip,
    limit,
    page,
    returnType,
    startTime,
    select: options.select,
    populate: options.populate,
  })
}

// ─── Normal Fetch ───────────────────────────────────────────────────────────

interface NormalParams<T> {
  filters: QueryFilter<T>
  sort: Record<string, 1 | -1>
  skip: number
  limit: number
  page: number
  returnType: string
  startTime: number
  select?: string | Record<string, number>
  populate?: string | PopulateOptions | (string | PopulateOptions)[]
}

const executeNormal = async <T>(
  model: Model<T>,
  params: NormalParams<T>,
): Promise<PaginationResult<T>> => {
  const { filters, sort, skip, limit, page, returnType, startTime, select, populate } = params

  // ── data mode: limit+1 trick, no count ──────────────────────────────────
  if (returnType === 'data') {
    const dbStart = performance.now()
    let query = model
      .find(filters)
      .sort(sort)
      .skip(skip)
      .limit(limit + 1)
      .lean()
    if (select) query = query.select(select) as typeof query
    if (populate)
      query = query.populate(
        populate as PopulateOptions | (string | PopulateOptions)[],
      ) as typeof query

    const rows = (await query.exec()) as T[]
    const databaseQueryTimeMs = Math.round(performance.now() - dbStart)

    const hasMore = rows.length > limit
    if (hasMore) rows.pop()

    return buildResult(rows, {
      page,
      limit,
      total: null,
      totalPages: null,
      hasMore,
      executionTimeMs: Math.round(performance.now() - startTime),
      databaseQueryTimeMs,
    })
  }

  // ── meta mode: count only, no data ──────────────────────────────────────
  if (returnType === 'meta') {
    const dbStart = performance.now()
    const total = await model.countDocuments(filters).exec()
    const databaseQueryTimeMs = Math.round(performance.now() - dbStart)

    return buildResult([], {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
      executionTimeMs: Math.round(performance.now() - startTime),
      databaseQueryTimeMs,
    })
  }

  // ── full mode: data + count in parallel ─────────────────────────────────
  const dbStart = performance.now()
  let dataQuery = model.find(filters).sort(sort).skip(skip).limit(limit).lean()
  if (select) dataQuery = dataQuery.select(select) as typeof dataQuery
  if (populate)
    dataQuery = dataQuery.populate(
      populate as PopulateOptions | (string | PopulateOptions)[],
    ) as typeof dataQuery

  const [rows, total] = await Promise.all([
    dataQuery.exec() as Promise<T[]>,
    model.countDocuments(filters).exec(),
  ])
  const databaseQueryTimeMs = Math.round(performance.now() - dbStart)

  return buildResult(rows, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total,
    executionTimeMs: Math.round(performance.now() - startTime),
    databaseQueryTimeMs,
  })
}

// ─── Grouped Fetch (Aggregation) ────────────────────────────────────────────

interface GroupedParams<T> {
  filters: QueryFilter<T>
  groupBy: string[]
  sort: Record<string, 1 | -1>
  skip: number
  limit: number
  page: number
  returnType: string
  startTime: number
}

const executeGrouped = async <T>(
  model: Model<T>,
  params: GroupedParams<T>,
): Promise<PaginationResult<T>> => {
  const { filters, groupBy, sort, skip, limit, page, returnType, startTime } = params

  const groupId: Record<string, string> = {}
  for (const field of groupBy) {
    groupId[field] = `$${field}`
  }

  const matchStage: PipelineStage[] =
    Object.keys(filters).length > 0 ? [{ $match: filters as Record<string, unknown> }] : []

  const groupStage: PipelineStage = {
    $group: { _id: groupId, count: { $sum: 1 } },
  }

  const projectStage: PipelineStage = {
    $project: { _id: 0, group: '$_id', count: 1 },
  }

  // Sort keys need `_id.` prefix for grouped results
  const groupSort: Record<string, 1 | -1> = {}
  for (const [key, val] of Object.entries(sort)) {
    groupSort[key.startsWith('_id.') ? key : `_id.${key}`] = val
  }

  if (returnType === 'meta') {
    const dbStart = performance.now()
    const countPipeline: PipelineStage[] = [...matchStage, groupStage, { $count: 'total' }]
    const countResult = await model.aggregate(countPipeline).exec()
    const total = countResult.length > 0 ? (countResult[0] as { total: number }).total : 0
    const databaseQueryTimeMs = Math.round(performance.now() - dbStart)

    return buildResult([], {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
      executionTimeMs: Math.round(performance.now() - startTime),
      databaseQueryTimeMs,
    })
  }

  const sortStage: PipelineStage[] = Object.keys(groupSort).length > 0 ? [{ $sort: groupSort }] : []

  const dataPipeline: PipelineStage[] = [
    ...matchStage,
    groupStage,
    ...sortStage,
    { $skip: skip },
    { $limit: limit },
    projectStage,
  ]

  if (returnType === 'data') {
    const dbStart = performance.now()
    const data = (await model.aggregate(dataPipeline).exec()) as T[]
    const databaseQueryTimeMs = Math.round(performance.now() - dbStart)

    return buildResult(data, {
      page,
      limit,
      total: null,
      totalPages: null,
      hasMore: data.length === limit,
      executionTimeMs: Math.round(performance.now() - startTime),
      databaseQueryTimeMs,
    })
  }

  // full
  const dbStart = performance.now()
  const countPipeline: PipelineStage[] = [...matchStage, groupStage, { $count: 'total' }]
  const [data, countResult] = await Promise.all([
    model.aggregate(dataPipeline).exec() as Promise<T[]>,
    model.aggregate(countPipeline).exec(),
  ])
  const total = countResult.length > 0 ? (countResult[0] as { total: number }).total : 0
  const databaseQueryTimeMs = Math.round(performance.now() - dbStart)

  return buildResult(data, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total,
    executionTimeMs: Math.round(performance.now() - startTime),
    databaseQueryTimeMs,
  })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const normalizeSort = (
  input?: Record<string, string>,
  defaultSort?: Record<string, 1 | -1>,
): Record<string, 1 | -1> => {
  if (!input || Object.keys(input).length === 0) {
    return defaultSort ?? { _id: -1 }
  }

  const result: Record<string, 1 | -1> = {}
  for (const [key, val] of Object.entries(input)) {
    result[key] = val === '-1' || val === 'desc' ? -1 : 1
  }
  return result
}

interface ResultParams {
  page: number
  limit: number
  total: number | null
  totalPages: number | null
  hasMore: boolean
  executionTimeMs: number
  databaseQueryTimeMs: number
}

const buildResult = <T>(data: T[], params: ResultParams): PaginationResult<T> => ({
  data,
  pagination: {
    page: params.page,
    limit: params.limit,
    total: params.total,
    totalPages: params.totalPages,
    hasMore: params.hasMore,
  },
  info: {
    executionTimeMs: params.executionTimeMs,
    databaseQueryTimeMs: params.databaseQueryTimeMs,
  },
})
