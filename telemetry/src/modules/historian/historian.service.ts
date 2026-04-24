import { CustomError } from '../../core/errors/index.js'
import { getHistorianCollection } from '../ingestion/historian.repository.js'
import Tag from '../tag/tag.model.js'
import { calculateStateDurations } from './calculations/binary.calc.js'
import {
  calculateProduced,
  calculateProducedMulti,
  type ProducedMultiResult,
  type ProducedWindowInput,
} from './calculations/counter.calc.js'
import {
  calculateSpeedAvg,
  calculateSpeedAvgMulti,
  type SpeedMultiResult,
  type SpeedWindowInput,
} from './calculations/speed.calc.js'

const SERIES_INTERVAL_CANDIDATES_MS = [
  1_000, 5_000, 10_000, 30_000, 60_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 14_400_000,
  28_800_000, 43_200_000, 86_400_000, 604_800_000, 2_592_000_000,
] as const

type SeriesFilterType = 'raw' | 'last_value_bucket'

export interface HistorianSeriesPoint {
  t: Date
  v: number
}

export interface HistorianSeriesStats {
  min: number | null
  max: number | null
  avg: number | null
  variance: number | null
  stddev: number | null
  count: number
}

export interface HistorianSeriesResult {
  points: HistorianSeriesPoint[]
  meta: {
    filterType: SeriesFilterType
    targetPoints: number
    returnedPoints: number
    truncated: boolean
    intervalMs: number | null
    stats: HistorianSeriesStats
  }
}

const ensureTagExists = async (tagId: string) => {
  const tag = await Tag.findById(tagId).select('behavior').lean()
  if (!tag) throw new CustomError(404, 'tag.not_found')
  return tag
}

const appendBaselinePoint = (
  points: HistorianSeriesPoint[],
  from: Date,
  baselineValue: number | null,
): HistorianSeriesPoint[] => {
  if (baselineValue == null) return points
  return [{ t: from, v: baselineValue }, ...points]
}

const pickSeriesIntervalMs = (from: Date, to: Date, targetPoints: number): number => {
  const rangeMs = Math.max(to.getTime() - from.getTime(), 1)
  for (const intervalMs of SERIES_INTERVAL_CANDIDATES_MS) {
    if (Math.ceil(rangeMs / intervalMs) <= targetPoints) {
      return intervalMs
    }
  }
  return Math.max(Math.ceil(rangeMs / targetPoints), 1)
}

const calculateSeriesStats = (points: HistorianSeriesPoint[]): HistorianSeriesStats => {
  if (points.length === 0) {
    return {
      min: null,
      max: null,
      avg: null,
      variance: null,
      stddev: null,
      count: 0,
    }
  }

  let min = points[0].v
  let max = points[0].v
  let sum = 0

  for (const point of points) {
    const value = point.v
    if (value < min) min = value
    if (value > max) max = value
    sum += value
  }

  const count = points.length
  const avg = sum / count

  let squaredDiffSum = 0
  for (const point of points) {
    const diff = point.v - avg
    squaredDiffSum += diff * diff
  }

  const variance = squaredDiffSum / count
  const stddev = Math.sqrt(variance)

  return {
    min,
    max,
    avg,
    variance,
    stddev,
    count,
  }
}

export const getCompactValues = async (tagId: string, from: Date, to: Date) => {
  await ensureTagExists(tagId)
  const collection = getHistorianCollection(tagId)

  const baseline = await collection.findOne(
    { occurredAt: { $lte: from } },
    { sort: { occurredAt: -1 }, projection: { _id: 0, v: '$value' } },
  )

  const docs = await collection
    .find(
      { occurredAt: { $gt: from, $lte: to } },
      { projection: { _id: 0, t: '$occurredAt', v: '$value' } },
    )
    .sort({ occurredAt: 1 })
    .toArray()

  if (!baseline) {
    return docs
  }

  return [{ t: from, v: baseline.v }, ...docs]
}

export const getSeries = async (
  tagId: string,
  from: Date,
  to: Date,
  targetPoints: number,
): Promise<HistorianSeriesResult> => {
  await ensureTagExists(tagId)
  const collection = getHistorianCollection(tagId)
  const rangeQuery = { occurredAt: { $gt: from, $lte: to } }

  const [baseline, probeDocs] = await Promise.all([
    collection.findOne<{ value?: number }>(
      { occurredAt: { $lte: from } },
      { sort: { occurredAt: -1 }, projection: { _id: 0, value: 1 } },
    ),
    collection
      .find<{ t: Date; v: number }>(rangeQuery, {
        projection: { _id: 0, t: '$occurredAt', v: '$value' },
      })
      .sort({ occurredAt: 1 })
      .limit(targetPoints + 1)
      .toArray(),
  ])

  if (probeDocs.length <= targetPoints) {
    const points = appendBaselinePoint(probeDocs, from, baseline?.value ?? null)
    return {
      points,
      meta: {
        filterType: 'raw',
        targetPoints,
        returnedPoints: points.length,
        truncated: false,
        intervalMs: null,
        stats: calculateSeriesStats(points),
      },
    }
  }

  const intervalMs = pickSeriesIntervalMs(from, to, targetPoints)
  const fromMs = from.getTime()

  const docs = await collection
    .aggregate<{ t: Date; v: number }>([
      { $match: rangeQuery },
      { $sort: { occurredAt: 1 } },
      {
        $group: {
          _id: {
            $subtract: [
              { $toLong: '$occurredAt' },
              {
                $mod: [{ $subtract: [{ $toLong: '$occurredAt' }, fromMs] }, intervalMs],
              },
            ],
          },
          t: { $last: '$occurredAt' },
          v: { $last: '$value' },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, t: 1, v: 1 } },
    ])
    .toArray()

  const points = appendBaselinePoint(docs, from, baseline?.value ?? null)
  return {
    points,
    meta: {
      filterType: 'last_value_bucket',
      targetPoints,
      returnedPoints: points.length,
      truncated: true,
      intervalMs,
      stats: calculateSeriesStats(points),
    },
  }
}

export const getSamples = async (
  tagId: string,
  from: Date,
  to: Date,
  page: number,
  limit: number,
  previous: boolean,
) => {
  await ensureTagExists(tagId)
  const collection = getHistorianCollection(tagId)

  const query = { occurredAt: { $gt: from, $lte: to } }
  const total = await collection.countDocuments(query)
  const totalPages = Math.ceil(total / limit)

  const docs = await collection
    .find(query)
    .sort({ occurredAt: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray()

  let previousDoc = null
  if (previous) {
    previousDoc = await collection.findOne(
      { occurredAt: { $lte: from } },
      { sort: { occurredAt: -1 } },
    )
  }

  return {
    data: docs,
    previousDoc,
    pagination: { page, limit, total, totalPages },
  }
}

export const getSampleCount = async (tagId: string, from: Date, to: Date) => {
  await ensureTagExists(tagId)
  const collection = getHistorianCollection(tagId)
  return collection.countDocuments({ occurredAt: { $gt: from, $lte: to } })
}

export const getStats = async (tagId: string, from: Date, to: Date) => {
  await ensureTagExists(tagId)
  const collection = getHistorianCollection(tagId)

  const result = await collection
    .aggregate([
      { $match: { occurredAt: { $gt: from, $lte: to } } },
      {
        $group: {
          _id: null,
          min: { $min: '$value' },
          max: { $max: '$value' },
          avg: { $avg: '$value' },
          variance: { $stdDevPop: '$value' },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray()

  if (result.length === 0) {
    return { min: null, max: null, avg: null, variance: null, stddev: null, count: 0 }
  }

  const r = result[0]
  return {
    min: r.min,
    max: r.max,
    avg: r.avg,
    variance: r.variance != null ? r.variance ** 2 : null,
    stddev: r.variance,
    count: r.count,
  }
}

export const getProduced = async (tagId: string, from: Date, to: Date) => {
  const tag = await ensureTagExists(tagId)
  if (tag.behavior !== 'counter') {
    throw new CustomError(400, 'historian.counter_only')
  }
  return calculateProduced(tagId, from, to)
}

export const getSpeedAvg = async (tagId: string, from: Date, to: Date) => {
  const tag = await ensureTagExists(tagId)
  if (tag.behavior !== 'speed') {
    throw new CustomError(400, 'historian.speed_only')
  }
  return calculateSpeedAvg(tagId, from, to)
}

export const getProducedSummary = async (
  tagId: string,
  windows: ProducedWindowInput[],
): Promise<ProducedMultiResult> => {
  const tag = await ensureTagExists(tagId)
  if (tag.behavior !== 'counter') {
    throw new CustomError(400, 'historian.counter_only')
  }
  return calculateProducedMulti(tagId, windows)
}

export const getSpeedSummary = async (
  tagId: string,
  windows: SpeedWindowInput[],
): Promise<SpeedMultiResult> => {
  const tag = await ensureTagExists(tagId)
  if (tag.behavior !== 'speed') {
    throw new CustomError(400, 'historian.speed_only')
  }
  return calculateSpeedAvgMulti(tagId, windows)
}

export const getStateDurations = async (tagId: string, from: Date, to: Date) => {
  const tag = await ensureTagExists(tagId)
  if (tag.behavior !== 'binary') {
    throw new CustomError(400, 'historian.binary_only')
  }
  return calculateStateDurations(tagId, from, to)
}

export const getLatest = async (tagId: string) => {
  await ensureTagExists(tagId)
  const collection = getHistorianCollection(tagId)
  const sample = await collection.findOne<{ value: number; occurredAt: Date }>(
    {},
    {
      sort: { occurredAt: -1, _id: -1 },
      projection: { _id: 0, value: 1, occurredAt: 1 },
    },
  )
  if (!sample) return null
  return { tagId, value: sample.value, occurredAt: sample.occurredAt }
}

export const getRollup = async (
  tagId: string,
  from: Date,
  to: Date,
  intervalMs: number,
  fn: 'avg' | 'min' | 'max' | 'sum' | 'count',
) => {
  await ensureTagExists(tagId)
  const collection = getHistorianCollection(tagId)

  const rangeQuery = { occurredAt: { $gt: from, $lte: to } }
  const fromMs = from.getTime()
  const toMs = to.getTime()

  const aggValue = (() => {
    switch (fn) {
      case 'avg':
        return { $avg: '$value' }
      case 'min':
        return { $min: '$value' }
      case 'max':
        return { $max: '$value' }
      case 'sum':
        return { $sum: '$value' }
      case 'count':
        return { $sum: 1 }
    }
  })()

  const [baseline, docs] = await Promise.all([
    collection.findOne(
      { occurredAt: { $lte: from } },
      { sort: { occurredAt: -1 }, projection: { value: 1, _id: 0 } },
    ),
    collection
      .aggregate<{ bucketStart: number; value: number | null; lastValue: number | null }>([
        { $match: rangeQuery },
        { $sort: { occurredAt: 1 } },
        {
          $group: {
            // Subtract 1ms so values that land exactly on a bucket boundary stay in the previous bucket.
            _id: {
              $add: [
                fromMs,
                {
                  $multiply: [
                    {
                      $floor: {
                        $divide: [
                          {
                            $subtract: [{ $subtract: [{ $toLong: '$occurredAt' }, fromMs] }, 1],
                          },
                          intervalMs,
                        ],
                      },
                    },
                    intervalMs,
                  ],
                },
              ],
            },
            value: aggValue,
            lastValue: { $last: '$value' },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, bucketStart: '$_id', value: 1, lastValue: 1 } },
      ])
      .toArray(),
  ])

  const buckets = []
  let bucketStart = fromMs
  let docIndex = 0
  let carryValue = (baseline?.value as number | null) ?? null

  while (bucketStart < toMs) {
    const bucketEnd = Math.min(bucketStart + intervalMs, toMs)
    let result = carryValue

    if (docIndex < docs.length && docs[docIndex].bucketStart === bucketStart) {
      result = docs[docIndex].value
      carryValue = docs[docIndex].lastValue
      docIndex++
    }

    buckets.push({
      start: new Date(bucketStart),
      end: new Date(bucketEnd),
      value: result,
    })

    bucketStart = bucketEnd
  }

  return buckets
}
