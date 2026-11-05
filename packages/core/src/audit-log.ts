import type { Schema } from 'mongoose'
import { getContext } from './middleware/request-context.js'

type Snapshot = Record<string, unknown>

// The parts of a Mongoose model and query the plugin uses. Instantiating Mongoose's own generic
// Model and Query types here changed how TypeScript compares Model types elsewhere in the program
// (pagination.test.ts stopped type-checking), so the plugin keeps to these narrow shapes
interface AnyModel {
  modelName: string
  find(filter: object, projection?: object): { lean(): PromiseLike<Snapshot[]> }
  findOne(filter: object): {
    sort(sort: unknown): { lean(): PromiseLike<Snapshot | null> }
    lean(): PromiseLike<Snapshot | null>
  }
  findById(id: unknown): { lean(): PromiseLike<Snapshot | null> }
}

interface AnyQuery {
  model: AnyModel
  getFilter(): object
  getOptions(): { sort?: unknown; upsert?: boolean; new?: boolean; returnDocument?: string }
}

interface AuditEntry {
  operation: 'create' | 'update' | 'delete'
  model: string
  documentId: string
  document: Snapshot | null
  previousDocument: Snapshot | null
}

export interface AuditLogPluginOptions {
  // The service's own audit log model. It carries no audit plugin, so writing to it is not audited
  auditLog: { insertMany(docs: object[]): Promise<unknown> }
  logger: { warn(message: string, meta: Record<string, unknown>): void }
  // Recorded as the actor of a change made outside a request: seeders, consumers, jobs
  systemIdentity: string
}

const SENSITIVE_FIELDS = new Set(['password', 'secret', 'token', 'accessToken'])

// A hydrated document or a lean result as a plain object, with sensitive values masked
function snapshot(doc: unknown): Snapshot {
  const plain =
    typeof (doc as { toObject?: unknown }).toObject === 'function'
      ? (doc as { toObject(): Snapshot }).toObject()
      : { ...(doc as Snapshot) }
  for (const key of Object.keys(plain)) {
    if (SENSITIVE_FIELDS.has(key) && typeof plain[key] === 'string') plain[key] = '****'
  }
  return plain
}

const idOf = (doc: unknown): string => String((doc as { _id: unknown })._id)

// Records every change to an audited model's documents: who changed which document, from which
// state to which. Mongoose runs these hooks for save(), insertMany() and the query writes
// (updateOne, updateMany, findOneAndUpdate, deleteOne, deleteMany, findOneAndDelete); in Mongoose
// 9.11 doc.updateOne() and doc.deleteOne() run the query hooks too, which the tests pin.
// bulkWrite(), aggregation stages that write and the driver's own collection methods bypass
// Mongoose middleware, so code must not change an audited model through them.
export function createAuditLogPlugin({ auditLog, logger, systemIdentity }: AuditLogPluginOptions) {
  // Builds the entries after the write, reading the new state where the write did not return it,
  // and appends them. The write it records never waits for it, and a failure is only logged
  const record = (model: string, build: () => Promise<AuditEntry[]>): void => {
    const context = getContext()
    const actor = {
      userId: context?.userId ?? systemIdentity,
      ip: context?.ip ?? '',
      traceId: context?.traceId ?? '',
    }
    build()
      .then(entries =>
        entries.length === 0
          ? undefined
          : auditLog.insertMany(
              entries.map(entry => ({ ...entry, ...actor, timestamp: new Date() })),
            ),
      )
      .catch(err => {
        logger.warn('Audit log write failed', {
          event: 'audit_log.write_failed',
          model,
          error: err instanceof Error ? err.message : err,
        })
      })
  }

  // The documents a query is about to change or delete, read before it runs
  const before = new WeakMap<object, Snapshot[]>()

  const capture = async (query: AnyQuery, many: boolean): Promise<void> => {
    try {
      const filter = query.getFilter()
      const found = many
        ? await query.model.find(filter).lean()
        : await query.model
            .findOne(filter)
            .sort(query.getOptions().sort ?? {})
            .lean()
      before.set(query, Array.isArray(found) ? found : found ? [found] : [])
    } catch (err) {
      before.set(query, [])
      logger.warn('Audit log could not read the state before a write', {
        event: 'audit_log.snapshot_failed',
        model: query.model.modelName,
        error: err instanceof Error ? err.message : err,
      })
    }
  }

  const takeBefore = (query: object): Snapshot[] => {
    const docs = before.get(query) ?? []
    before.delete(query)
    return docs
  }

  return (schema: Schema): void => {
    // save() inserts a new document or updates one that was read
    schema.pre('save', async function () {
      this.$locals.auditCreated = this.isNew
      if (this.isNew) return
      try {
        const model = this.constructor as unknown as AnyModel
        this.$locals.auditPrevious = await model.findById(this._id).lean()
      } catch (err) {
        this.$locals.auditPrevious = null
        logger.warn('Audit log could not read the state before a write', {
          event: 'audit_log.snapshot_failed',
          model: (this.constructor as unknown as AnyModel).modelName,
          error: err instanceof Error ? err.message : err,
        })
      }
    })

    schema.post('save', doc => {
      const created = doc.$locals.auditCreated === true
      const previous = doc.$locals.auditPrevious
      delete doc.$locals.auditCreated
      delete doc.$locals.auditPrevious
      const model = (doc.constructor as unknown as AnyModel).modelName
      const entry: AuditEntry = {
        operation: created ? 'create' : 'update',
        model,
        documentId: idOf(doc),
        document: snapshot(doc),
        previousDocument: previous ? snapshot(previous) : null,
      }
      record(model, async () => [entry])
    })

    schema.post('insertMany', function (docs: unknown) {
      if (!Array.isArray(docs)) return
      const model = (this as unknown as AnyModel).modelName
      const entries = docs.map(
        (doc): AuditEntry => ({
          operation: 'create',
          model,
          documentId: idOf(doc),
          document: snapshot(doc),
          previousDocument: null,
        }),
      )
      record(model, async () => entries)
    })

    schema.pre('findOneAndUpdate', async function () {
      await capture(this as unknown as AnyQuery, false)
    })

    schema.post('findOneAndUpdate', function (result: unknown) {
      const query = this as unknown as AnyQuery
      const [previous] = takeBefore(query)
      const options = query.getOptions()
      if (!result && !(options.upsert && !previous)) return
      const model = query.model.modelName
      const returnsNew = options.new === true || options.returnDocument === 'after'
      const current = result && returnsNew ? snapshot(result) : null
      record(model, async () => {
        // The query returned the old state, or nothing after an upsert, so the new one is read
        const after =
          current ??
          (await query.model
            .findOne(result ? { _id: (result as Snapshot)._id } : query.getFilter())
            .lean())
        if (!after) return []
        return [
          {
            operation: previous ? 'update' : 'create',
            model,
            documentId: idOf(after),
            document: current ?? snapshot(after),
            previousDocument: previous ? snapshot(previous) : null,
          },
        ]
      })
    })

    for (const op of ['updateOne', 'updateMany'] as const) {
      schema.pre(op, { document: false, query: true }, async function () {
        await capture(this as unknown as AnyQuery, op === 'updateMany')
      })

      schema.post(op, { document: false, query: true }, function (result: unknown) {
        const query = this as unknown as AnyQuery
        const previous = takeBefore(query)
        const upsertedId = (result as { upsertedId?: unknown } | null)?.upsertedId ?? null
        if (previous.length === 0 && upsertedId === null) return
        const model = query.model.modelName
        record(model, async () => {
          const ids = previous.map(doc => doc._id)
          if (upsertedId !== null) ids.push(upsertedId)
          const after = new Map(
            (await query.model.find({ _id: { $in: ids } }).lean()).map(doc => [idOf(doc), doc]),
          )
          const entries = previous.map(
            (doc): AuditEntry => ({
              operation: 'update',
              model,
              documentId: idOf(doc),
              document: after.has(idOf(doc)) ? snapshot(after.get(idOf(doc))) : null,
              previousDocument: snapshot(doc),
            }),
          )
          const created = upsertedId === null ? undefined : after.get(String(upsertedId))
          if (created) {
            entries.push({
              operation: 'create',
              model,
              documentId: idOf(created),
              document: snapshot(created),
              previousDocument: null,
            })
          }
          return entries
        })
      })
    }

    for (const op of ['deleteOne', 'deleteMany'] as const) {
      schema.pre(op, { document: false, query: true }, async function () {
        await capture(this as unknown as AnyQuery, op === 'deleteMany')
      })

      schema.post(op, { document: false, query: true }, function (result: unknown) {
        const query = this as unknown as AnyQuery
        const previous = takeBefore(query)
        if (previous.length === 0 || !(result as { deletedCount?: number } | null)?.deletedCount) {
          return
        }
        const model = query.model.modelName
        record(model, async () => {
          // A matched document that is still there was not the one deleted
          const left = new Set(
            (
              await query.model
                .find({ _id: { $in: previous.map(doc => doc._id) } }, { _id: 1 })
                .lean()
            ).map(idOf),
          )
          return previous
            .filter(doc => !left.has(idOf(doc)))
            .map(doc => ({
              operation: 'delete',
              model,
              documentId: idOf(doc),
              document: null,
              previousDocument: snapshot(doc),
            }))
        })
      })
    }

    schema.post('findOneAndDelete', function (result: unknown) {
      if (!result) return
      const query = this as unknown as AnyQuery
      const model = query.model.modelName
      const entry: AuditEntry = {
        operation: 'delete',
        model,
        documentId: idOf(result),
        document: null,
        previousDocument: snapshot(result),
      }
      record(model, async () => [entry])
    })
  }
}
