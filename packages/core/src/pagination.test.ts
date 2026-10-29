import { setupMongoTestContainer } from '@mes/testing'
import mongoose from 'mongoose'
import { describe, expect, it } from 'vitest'
import { paginate } from './pagination.js'

setupMongoTestContainer()

const Item = mongoose.model(
  'PaginationItem',
  new mongoose.Schema({ name: String, rank: Number }, { timestamps: true }),
)

describe('paginate', () => {
  // MongoDB returns documents with equal sort values in no fixed order, and that order changes
  // with skip and limit. Without a unique tiebreaker, a client paging through the list sees some
  // documents twice and never sees others.
  it('returns every document exactly once when they share the sort value', async () => {
    const createdAt = new Date('2026-10-28T08:00:00.000Z')
    await Item.collection.insertMany(
      Array.from({ length: 1000 }, (_, i) => ({
        name: `item-${i}`,
        rank: 1,
        createdAt,
        updatedAt: createdAt,
      })),
    )

    for (const sort of [undefined, 'rank', '-rank']) {
      const seen: string[] = []
      for (let page = 1; page <= 100; page++) {
        const { data } = await paginate(
          Item,
          {},
          { page, limit: 10, sort },
          { allowedSortFields: ['rank'] },
        )
        seen.push(...data.map(doc => String(doc._id)))
      }
      expect(new Set(seen).size, `sort=${sort ?? 'default'}`).toBe(1000)
    }
  })
})
