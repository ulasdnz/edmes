import type { Schema } from 'mongoose'
import { SYSTEM_IDENTITY } from '../../constants/identity.js'
import { getContext } from '../../core/middleware/request-context.js'
import AuditLog from './audit-log.model.js'

const SENSITIVE_FIELDS = new Set(['password', 'secret', 'token', 'accessToken'])

const maskSensitiveFields = (doc: Record<string, unknown>): Record<string, unknown> => {
  const masked = { ...doc }
  for (const key of Object.keys(masked)) {
    if (SENSITIVE_FIELDS.has(key) && typeof masked[key] === 'string') {
      masked[key] = '****'
    }
  }
  return masked
}

const extractContext = () => {
  const ctx = getContext()
  return {
    userId: ctx?.userId ?? SYSTEM_IDENTITY,
    ip: ctx?.ip ?? '',
    traceId: ctx?.traceId ?? '',
  }
}

const writeAuditLog = async (entry: {
  operation: 'create' | 'update' | 'delete'
  model: string
  documentId: string
  document: unknown
  previousDocument: unknown
}): Promise<void> => {
  try {
    const ctx = extractContext()
    await AuditLog.create({
      ...entry,
      ...ctx,
      timestamp: new Date(),
    })
  } catch {
    // Audit log failure must never crash the main operation.
  }
}

const preUpdateSnapshots = new WeakMap<object, Record<string, unknown> | null>()

const auditLogPlugin = (schema: Schema): void => {
  schema.post('save', doc => {
    const plain = doc.toObject()
    const documentId = String(plain._id)
    const modelName = (doc.constructor as { modelName?: string }).modelName ?? 'Unknown'

    void writeAuditLog({
      operation: 'create',
      model: modelName,
      documentId,
      document: maskSensitiveFields(plain),
      previousDocument: null,
    })
  })

  schema.pre('findOneAndUpdate', async function () {
    try {
      const filter = this.getFilter()
      const oldDoc = await this.model.findOne(filter).lean()
      preUpdateSnapshots.set(
        this,
        oldDoc ? maskSensitiveFields(oldDoc as Record<string, unknown>) : null,
      )
    } catch {
      preUpdateSnapshots.set(this, null)
    }
  })

  schema.post('findOneAndUpdate', function (doc) {
    if (!doc) return

    const plain = doc.toObject()
    const documentId = String(plain._id)
    const model = (this as unknown as { model: { modelName: string } }).model.modelName ?? 'Unknown'
    const oldDoc = preUpdateSnapshots.get(this) ?? null
    preUpdateSnapshots.delete(this)

    void writeAuditLog({
      operation: 'update',
      model,
      documentId,
      document: maskSensitiveFields(plain),
      previousDocument: oldDoc,
    })
  })

  schema.post('findOneAndDelete', function (doc) {
    if (!doc) return

    const plain = doc.toObject()
    const documentId = String(plain._id)
    const model = (this as unknown as { model: { modelName: string } }).model.modelName ?? 'Unknown'

    void writeAuditLog({
      operation: 'delete',
      model,
      documentId,
      document: null,
      previousDocument: maskSensitiveFields(plain),
    })
  })
}

export default auditLogPlugin
