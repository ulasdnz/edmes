import { getHistorianCollection } from '../../ingestion/historian.repository.js'

interface SpeedDoc {
  occurredAt: Date
  value: number
}

export const calculateSpeedAvg = async (
  tagId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{ totalArea: number; weightedAvg: number; durationSec: number }> => {
  const collection = getHistorianCollection(tagId)

  const baseline = await collection.findOne<SpeedDoc>(
    { occurredAt: { $lt: rangeStart } },
    { sort: { occurredAt: -1 } },
  )

  const docs = await collection
    .find<SpeedDoc>({ occurredAt: { $gte: rangeStart, $lte: rangeEnd } })
    .sort({ occurredAt: 1 })
    .toArray()

  const points: { time: Date; value: number }[] = []

  if (baseline) {
    points.push({ time: rangeStart, value: baseline.value })
  } else if (docs.length > 0) {
    points.push({ time: rangeStart, value: 0 })
  } else {
    return { totalArea: 0, weightedAvg: 0, durationSec: 0 }
  }

  for (const doc of docs) {
    points.push({ time: doc.occurredAt, value: doc.value })
  }

  points.push({ time: rangeEnd, value: points[points.length - 1].value })

  let totalArea = 0
  for (let i = 0; i < points.length - 1; i++) {
    const durationMs = points[i + 1].time.getTime() - points[i].time.getTime()
    const durationSec = durationMs / 1000
    totalArea += points[i].value * durationSec
  }

  const totalDurationSec = (rangeEnd.getTime() - rangeStart.getTime()) / 1000
  const weightedAvg = totalDurationSec > 0 ? totalArea / totalDurationSec : 0

  return { totalArea, weightedAvg, durationSec: totalDurationSec }
}
