import { CustomError } from '../../core/errors/index.js'
import { getHistorianCollection } from '../ingestion/historian.repository.js'
import Tag from '../tag/tag.model.js'
import { calculateStateDurations } from './calculations/binary.calc.js'
import { calculateProduced } from './calculations/counter.calc.js'
import { calculateSpeedAvg } from './calculations/speed.calc.js'

const ensureTagExists = async (tagId: string) => {
  const tag = await Tag.findById(tagId).select('behavior').lean()
  if (!tag) throw new CustomError(404, 'tag.not_found')
  return tag
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

export const getStateDurations = async (tagId: string, from: Date, to: Date) => {
  const tag = await ensureTagExists(tagId)
  if (tag.behavior !== 'binary') {
    throw new CustomError(400, 'historian.binary_only')
  }
  return calculateStateDurations(tagId, from, to)
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

  const baseline = await collection.findOne(
    { occurredAt: { $lte: from } },
    { sort: { occurredAt: -1 }, projection: { value: 1, _id: 0 } },
  )

  const docs = await collection
    .find(
      { occurredAt: { $gt: from, $lte: to } },
      { projection: { occurredAt: 1, value: 1, _id: 0 } },
    )
    .sort({ occurredAt: 1 })
    .toArray()

  const buckets = []
  let bucketStart = from.getTime()
  let docIndex = 0
  let carryValue = (baseline?.value as number | null) ?? null

  while (bucketStart < to.getTime()) {
    const bucketEnd = Math.min(bucketStart + intervalMs, to.getTime())
    const values: number[] = []

    while (docIndex < docs.length && (docs[docIndex].occurredAt as Date).getTime() <= bucketEnd) {
      values.push(docs[docIndex].value as number)
      carryValue = docs[docIndex].value as number
      docIndex++
    }

    let result: number | null = null
    if (values.length > 0) {
      switch (fn) {
        case 'avg':
          result = values.reduce((a, b) => a + b, 0) / values.length
          break
        case 'min':
          result = Math.min(...values)
          break
        case 'max':
          result = Math.max(...values)
          break
        case 'sum':
          result = values.reduce((a, b) => a + b, 0)
          break
        case 'count':
          result = values.length
          break
      }
    } else {
      result = carryValue
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
