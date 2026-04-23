import type { Types } from 'mongoose'
import { QuantityAdjustment } from '../quantity-adjustment/quantity-adjustment.model.js'
import { ScrapEntry } from '../scrap-entry/scrap-entry.model.js'
import type { JobOrderRecordsBatchInput } from './job-order-records-batch.validators.js'

export interface QuantityAdjustmentProjection {
  _id: string
  jobOrderId: string
  workCenterId: string
  productId: string
  amount: number
  time: Date
  reason: string | null
}

export interface ScrapEntryProjection {
  _id: string
  jobOrderId: string
  workCenterId: string
  productId: string
  amount: number
  reasonId: string | null
  startTime: Date
  endTime: Date
}

export interface JobOrderRecordsBatchResult {
  quantityAdjustmentsByJobOrderId?: Record<string, QuantityAdjustmentProjection[]>
  scrapEntriesByJobOrderId?: Record<string, ScrapEntryProjection[]>
}

type QaDoc = {
  _id: Types.ObjectId
  jobOrderId: Types.ObjectId
  workCenterId: Types.ObjectId
  productId: Types.ObjectId
  amount: number
  time: Date
  reason: string | null
}

type ScrapDoc = {
  _id: Types.ObjectId
  jobOrderId: Types.ObjectId
  workCenterId: Types.ObjectId
  productId: Types.ObjectId
  amount: number
  reasonId: Types.ObjectId | null
  startTime: Date
  endTime: Date
}

export async function findJobOrderRecordsBatch(
  input: JobOrderRecordsBatchInput,
): Promise<JobOrderRecordsBatchResult> {
  const { items, include } = input
  const result: JobOrderRecordsBatchResult = {}

  if (items.length === 0) {
    if (include.includes('quantity_adjustments')) result.quantityAdjustmentsByJobOrderId = {}
    if (include.includes('scrap_entries')) result.scrapEntriesByJobOrderId = {}
    return result
  }

  if (include.includes('quantity_adjustments')) {
    const or = items.map(i => ({
      jobOrderId: i.jobOrderId,
      time: { $gte: i.from, $lte: i.to },
    }))
    const docs = await QuantityAdjustment.find({ $or: or })
      .select('_id jobOrderId workCenterId productId amount time reason')
      .lean<QaDoc[]>()

    const grouped: Record<string, QuantityAdjustmentProjection[]> = {}
    for (const id of new Set(items.map(i => i.jobOrderId))) grouped[id] = []
    for (const d of docs) {
      const key = d.jobOrderId.toString()
      const bucket = grouped[key] ?? []
      bucket.push({
        _id: d._id.toString(),
        jobOrderId: key,
        workCenterId: d.workCenterId.toString(),
        productId: d.productId.toString(),
        amount: d.amount,
        time: d.time,
        reason: d.reason,
      })
      grouped[key] = bucket
    }
    result.quantityAdjustmentsByJobOrderId = grouped
  }

  if (include.includes('scrap_entries')) {
    const or = items.map(i => ({
      jobOrderId: i.jobOrderId,
      startTime: { $lte: i.to },
      $or: [{ endTime: null }, { endTime: { $gte: i.from } }],
    }))
    const docs = await ScrapEntry.find({ $or: or })
      .select('_id jobOrderId workCenterId productId amount reasonId startTime endTime')
      .lean<ScrapDoc[]>()

    const grouped: Record<string, ScrapEntryProjection[]> = {}
    for (const id of new Set(items.map(i => i.jobOrderId))) grouped[id] = []
    for (const d of docs) {
      const key = d.jobOrderId.toString()
      const bucket = grouped[key] ?? []
      bucket.push({
        _id: d._id.toString(),
        jobOrderId: key,
        workCenterId: d.workCenterId.toString(),
        productId: d.productId.toString(),
        amount: d.amount,
        reasonId: d.reasonId ? d.reasonId.toString() : null,
        startTime: d.startTime,
        endTime: d.endTime,
      })
      grouped[key] = bucket
    }
    result.scrapEntriesByJobOrderId = grouped
  }

  return result
}
