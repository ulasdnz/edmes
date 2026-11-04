import { setupMongoDatabase } from '@mes/testing'
import mongoose from 'mongoose'
import { describe, expect, it } from 'vitest'
import { paginate } from './pagination.js'

setupMongoDatabase()

const Item = mongoose.model(
  'PaginationItem',
  new mongoose.Schema({ name: String, rank: Number }, { timestamps: true }),
)

const CodedItem = mongoose.model(
  'PaginationCodedItem',
  new mongoose.Schema({ code: { type: String, unique: true } }, { timestamps: true }),
)

// Codes stored the way codeSchema stores them, inserted out of code order
async function insertCodedItems(count: number) {
  await CodedItem.init()
  await CodedItem.collection.insertMany(
    Array.from({ length: count }, (_, i) => {
      const n = (i * 7919) % count
      return {
        code: `JO-2026-${String(n).padStart(4, '0')}`,
        createdAt: new Date(2026, 0, 1, 0, i),
      }
    }),
  )
}

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

  it('searches a code by prefix, as the code is stored, and returns matches in code order', async () => {
    await insertCodedItems(2000)

    const { data, pagination } = await paginate(
      CodedItem,
      {},
      { page: 1, limit: 3, search: ' jo-2026-01' },
      { codeField: 'code' },
    )

    expect(data.map(item => item.code)).toEqual(['JO-2026-0100', 'JO-2026-0101', 'JO-2026-0102'])
    expect(pagination.total).toBe(100)
  })

  // A prefix of the stored spelling bounds a scan of the unique code index, which also returns
  // the matches in code order: the page reads as many keys as it returns, whatever the size of
  // the collection, and nothing is sorted in memory.
  it('serves a code search from the code index', async () => {
    await insertCodedItems(2000)
    const db = mongoose.connection.db as mongoose.mongo.Db
    await db.command({ profile: 0 })
    await db
      .collection('system.profile')
      .drop()
      .catch(() => undefined)

    await db.command({ profile: 2 })
    await paginate(
      CodedItem,
      {},
      { page: 2, limit: 20, search: 'JO-2026-1' },
      { codeField: 'code' },
    )
    await db.command({ profile: 0 })

    const [find] = await db
      .collection('system.profile')
      .find({ ns: `${db.databaseName}.${CodedItem.collection.collectionName}`, op: 'query' })
      .toArray()
    expect(find.planSummary).toBe('IXSCAN { code: 1 }')
    expect(find.hasSortStage).toBeFalsy()
    expect(find.keysExamined).toBeLessThanOrEqual(40 + 1)
  })
})
