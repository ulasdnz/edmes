import mongoose, { Schema } from 'mongoose'

export interface IAuditLog {
  timestamp: Date
  operation: 'create' | 'update' | 'delete'
  model: string
  documentId: string
  userId: string
  ip: string
  traceId: string
  document: unknown
  previousDocument: unknown
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    timestamp: { type: Date, required: true, default: Date.now },
    operation: {
      type: String,
      required: true,
      enum: ['create', 'update', 'delete'],
    },
    model: { type: String, required: true, index: true },
    documentId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    ip: { type: String, default: '' },
    traceId: { type: String, default: '' },
    document: { type: Schema.Types.Mixed, default: null },
    previousDocument: { type: Schema.Types.Mixed, default: null },
  },
  {
    versionKey: false,
    collection: 'audit_logs',
    // Append-only — no updates, no deletes on this collection
    strict: true,
  },
)

// Compound index for querying: "what happened to this document?"
auditLogSchema.index({ model: 1, documentId: 1, timestamp: -1 })

// Index for querying: "what did this user do?"
auditLogSchema.index({ userId: 1, timestamp: -1 })

const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema)

export default AuditLog
