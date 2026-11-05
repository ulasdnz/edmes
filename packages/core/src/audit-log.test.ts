import { setupMongoDatabase } from '@mes/testing'
import mongoose, { Schema } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { createAuditLogPlugin } from './audit-log.js'
import { runInContext } from './middleware/request-context.js'

setupMongoDatabase()

type Entry = {
  operation: string
  model: string
  documentId: string
  userId: string
  ip: string
  traceId: string
  document: Record<string, unknown> | null
  previousDocument: Record<string, unknown> | null
}

const AuditLog = mongoose.model(
  'AuditLogUnderTest',
  new Schema({}, { collection: 'audit_logs', strict: false, versionKey: false }),
)

const logger = { warn: vi.fn() }
const itemSchema = new Schema(
  { name: String, count: Number, password: String },
  { timestamps: true },
)
itemSchema.plugin(createAuditLogPlugin({ auditLog: AuditLog, logger, systemIdentity: 'system' }))
const Item = mongoose.model('AuditedItem', itemSchema)

// Entries are written after the write returns: waits until the expected number of a document's
// entries exist and no more arrive
async function entriesOf(documentId: unknown, count: number): Promise<Entry[]> {
  const read = () =>
    AuditLog.find({ documentId: String(documentId) })
      .sort({ timestamp: 1, _id: 1 })
      .lean<Entry[]>()
  const deadline = Date.now() + 5000
  let entries = await read()
  while (entries.length < count && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25))
    entries = await read()
  }
  await new Promise(resolve => setTimeout(resolve, 150))
  return read()
}

describe('audit log plugin', () => {
  it('records a document saved for the first time as created, with sensitive values masked', async () => {
    const item = await Item.create({ name: 'press', password: 'hunter22' })

    const [entry, ...rest] = await entriesOf(item._id, 1)
    expect(rest).toEqual([])
    expect(entry).toMatchObject({ operation: 'create', model: 'AuditedItem', userId: 'system' })
    expect(entry.document).toMatchObject({ name: 'press', password: '****' })
    expect(entry.previousDocument).toBeNull()
  })

  it('records save() of a document read from the database as an update with its state before', async () => {
    const created = await Item.create({ name: 'press', count: 1 })
    await entriesOf(created._id, 1)

    const item = await Item.findById(created._id).orFail()
    item.name = 'lathe'
    item.count = 2
    await item.save()

    const entries = await entriesOf(item._id, 2)
    expect(entries.map(e => e.operation)).toEqual(['create', 'update'])
    expect(entries[1].previousDocument).toMatchObject({ name: 'press', count: 1 })
    expect(entries[1].document).toMatchObject({ name: 'lathe', count: 2 })
  })

  it('records findOneAndUpdate with the state before and after, whichever state it returns', async () => {
    const item = await Item.create({ name: 'press', count: 1 })
    await entriesOf(item._id, 1)

    await Item.findOneAndUpdate({ _id: item._id }, { count: 2 }, { returnDocument: 'after' })
    await Item.findOneAndUpdate({ _id: item._id }, { count: 3 })
    await Item.findOneAndUpdate({ _id: item._id }, { count: 4 }, { returnDocument: 'after' }).lean()
    await Item.findByIdAndUpdate(item._id, { count: 5 })

    const updates = (await entriesOf(item._id, 5)).slice(1)
    expect(updates.map(e => [e.operation, e.previousDocument?.count, e.document?.count])).toEqual([
      ['update', 1, 2],
      ['update', 2, 3],
      ['update', 3, 4],
      ['update', 4, 5],
    ])
  })

  it('records a document findOneAndUpdate inserts by upsert as created', async () => {
    const item = await Item.findOneAndUpdate(
      { name: 'new press' },
      { count: 1 },
      { upsert: true, returnDocument: 'after' },
    ).orFail()

    const [entry, ...rest] = await entriesOf(item._id, 1)
    expect(rest).toEqual([])
    expect(entry).toMatchObject({ operation: 'create', previousDocument: null })
    expect(entry.document).toMatchObject({ name: 'new press', count: 1 })
  })

  it('records updateOne and updateMany once for each document they change, and upserts as created', async () => {
    const [a, b, untouched] = await Item.create([
      { name: 'a', count: 1 },
      { name: 'b', count: 1 },
      { name: 'c', count: 9 },
    ])
    await Promise.all([a, b, untouched].map(doc => entriesOf(doc._id, 1)))

    await Item.updateOne({ _id: a._id }, { count: 2 })
    await Item.updateMany({ count: { $lt: 5 } }, { $inc: { count: 10 } })
    await Item.updateOne({ name: 'nobody' }, { count: 1 })
    const upsert = await Item.updateOne({ name: 'd' }, { count: 5 }, { upsert: true })

    const ofA = await entriesOf(a._id, 3)
    expect(
      ofA.slice(1).map(e => [e.operation, e.previousDocument?.count, e.document?.count]),
    ).toEqual([
      ['update', 1, 2],
      ['update', 2, 12],
    ])
    const ofB = await entriesOf(b._id, 2)
    expect(
      ofB.slice(1).map(e => [e.operation, e.previousDocument?.count, e.document?.count]),
    ).toEqual([['update', 1, 11]])
    expect(await entriesOf(untouched._id, 1)).toHaveLength(1)
    const [created, ...rest] = await entriesOf(upsert.upsertedId, 1)
    expect(rest).toEqual([])
    expect(created).toMatchObject({ operation: 'create', previousDocument: null })
    expect(created.document).toMatchObject({ name: 'd', count: 5 })
  })

  it('records doc.updateOne() once, as an update', async () => {
    const item = await Item.create({ name: 'press', count: 1 })
    await entriesOf(item._id, 1)

    await item.updateOne({ count: 2 })

    const entries = await entriesOf(item._id, 2)
    expect(entries.map(e => [e.operation, e.previousDocument?.count, e.document?.count])).toEqual([
      ['create', undefined, 1],
      ['update', 1, 2],
    ])
  })

  it('records every way of deleting a document, with the state it was deleted in', async () => {
    const [a, b, c, d, e] = await Item.create(
      ['a', 'b', 'c', 'd', 'e'].map(name => ({ name, count: 1 })),
    )
    await Promise.all([a, b, c, d, e].map(doc => entriesOf(doc._id, 1)))

    await Item.deleteOne({ _id: a._id })
    await Item.deleteMany({ _id: { $in: [b._id, c._id] } })
    await Item.findOneAndDelete({ _id: d._id }).lean()
    await e.deleteOne()
    await Item.deleteOne({ name: 'nobody' })

    for (const doc of [a, b, c, d, e]) {
      const entries = await entriesOf(doc._id, 2)
      expect(entries.map(entry => entry.operation)).toEqual(['create', 'delete'])
      expect(entries[1].document).toBeNull()
      expect(entries[1].previousDocument).toMatchObject({ name: doc.name, count: 1 })
    }
  })

  it('records insertMany as created documents', async () => {
    const docs = await Item.insertMany([{ name: 'a' }, { name: 'b' }])

    for (const doc of docs) {
      const [entry, ...rest] = await entriesOf(doc._id, 1)
      expect(rest).toEqual([])
      expect(entry).toMatchObject({ operation: 'create', previousDocument: null })
      expect(entry.document).toMatchObject({ name: doc.name })
    }
  })

  it('records the actor of the request the change was made in', async () => {
    const item = await runInContext({ traceId: 'trace-1', ip: '10.0.0.7', userId: 'user-1' }, () =>
      Item.create({ name: 'press' }),
    )

    const [entry] = await entriesOf(item._id, 1)
    expect(entry).toMatchObject({ userId: 'user-1', ip: '10.0.0.7', traceId: 'trace-1' })
  })

  it('never fails the write it records when the audit log cannot be written', async () => {
    const warn = vi.fn()
    const failing = new Schema({ name: String })
    failing.plugin(
      createAuditLogPlugin({
        auditLog: { insertMany: () => Promise.reject(new Error('audit store down')) },
        logger: { warn },
        systemIdentity: 'system',
      }),
    )
    const Failing = mongoose.model('AuditedWhileFailing', failing)

    const item = await Failing.create({ name: 'press' })
    await Failing.updateOne({ _id: item._id }, { name: 'lathe' })

    expect(await Failing.findById(item._id).lean()).toMatchObject({ name: 'lathe' })
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2))
    expect(warn).toHaveBeenCalledWith(
      'Audit log write failed',
      expect.objectContaining({ event: 'audit_log.write_failed', model: 'AuditedWhileFailing' }),
    )
  })
})
