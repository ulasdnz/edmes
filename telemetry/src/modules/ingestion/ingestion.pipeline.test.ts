import { setupMongoTestContainer } from '@mes/testing'
import { Types } from 'mongoose'
import { afterEach, describe, expect, it } from 'vitest'
import { setPeriodLock } from '../../jobs/subscribers.js'
import type { ITag } from '../tag/tag.model.js'
import { getHistorianCollection } from './historian.repository.js'
import { ingestValue } from './ingestion.pipeline.js'

setupMongoTestContainer()

const makeTag = (behavior: 'counter' | 'speed' | 'binary'): ITag =>
  ({ _id: new Types.ObjectId(), behavior, tolerance: 0 }) as unknown as ITag

const at = (second: number) => new Date(Date.UTC(2026, 3, 1, 8, 0, second))

const storedSamples = (tag: ITag) =>
  getHistorianCollection(tag._id.toString())
    .find({}, { projection: { _id: 0 } })
    .sort({ occurredAt: 1 })
    .toArray()

// MQTT messages for one tag are handled without awaiting the previous one, so a burst
// (e.g. an edge device flushing its buffer after a reconnect) reaches ingestValue concurrently.
describe('ingestValue with concurrent samples for the same tag', () => {
  afterEach(() => {
    setPeriodLock(null)
  })

  it('links every sample to the one before it', async () => {
    const tag = makeTag('counter')

    await Promise.all([
      ingestValue(tag, 100, at(1)),
      ingestValue(tag, 101, at(2)),
      ingestValue(tag, 102, at(3)),
    ])

    expect(await storedSamples(tag)).toEqual([
      {
        occurredAt: at(1),
        value: 100,
        prevValue: null,
        prevTs: null,
        prev2Value: null,
        prev2Ts: null,
        reset: false,
      },
      {
        occurredAt: at(2),
        value: 101,
        prevValue: 100,
        prevTs: at(1),
        prev2Value: null,
        prev2Ts: null,
        reset: false,
      },
      {
        occurredAt: at(3),
        value: 102,
        prevValue: 101,
        prevTs: at(2),
        prev2Value: 100,
        prev2Ts: at(1),
        reset: false,
      },
    ])
  })

  it('stores a repeated value only once', async () => {
    const tag = makeTag('speed')

    const results = await Promise.all([ingestValue(tag, 5, at(1)), ingestValue(tag, 5, at(2))])

    expect(results).toEqual([
      { applied: true, reason: 'history_inserted' },
      { applied: false, reason: 'same_value' },
    ])
    expect(await storedSamples(tag)).toHaveLength(1)
  })

  it('keeps ingesting after a sample for the same tag is rejected', async () => {
    const tag = makeTag('speed')
    setPeriodLock(at(1))

    const results = await Promise.allSettled([
      ingestValue(tag, 5, at(1)),
      ingestValue(tag, 6, at(2)),
    ])

    expect(results[0].status).toBe('rejected')
    expect(results[1]).toEqual({
      status: 'fulfilled',
      value: { applied: true, reason: 'history_inserted' },
    })
    expect(await storedSamples(tag)).toMatchObject([{ value: 6, prevValue: null }])
  })
})
