import mongoose, { type InferSchemaType, type Types } from 'mongoose'
import auditLogPlugin from '../../lib/plugins/audit-log.plugin.js'

const { Schema, model } = mongoose

// ── Sub-schemas (physical-only) ──────────────────────────────────────────────

const tagBindingsSchema = new Schema(
  {
    productionCounterTagId: { type: Schema.Types.ObjectId, required: true },
    runModeTagId: { type: Schema.Types.ObjectId, required: true },
    speedTagId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
)

const actionSettingsSchema = new Schema(
  {
    jobOrderMissingThresholdMs: { type: Number, required: true },
    operatorMissingThresholdMs: { type: Number, required: true },
    uncausedDowntimeThresholdMs: { type: Number, required: true },
    downtimeConfirmationDeadlineMs: { type: Number, required: true },
    serviceOverrunThresholdMs: { type: Number, required: true },
  },
  { _id: false },
)

// ── Sub-schemas (virtual-only: metric composition) ───────────────────────────

const contributorSchema = new Schema(
  {
    workCenterId: { type: Schema.Types.ObjectId, required: true },
    weight: { type: Number, min: 0, max: 1, default: null },
  },
  { _id: false },
)

const compositionRuleSchema = new Schema(
  {
    rule: {
      type: String,
      enum: ['primary_work_center', 'average', 'weighted'],
      required: true,
    },
    contributors: { type: [contributorSchema], required: true },
  },
  { _id: false },
)

const metricCompositionSchema = new Schema(
  {
    availability: { type: compositionRuleSchema, required: true },
    productivity: { type: compositionRuleSchema, required: true },
    quality: { type: compositionRuleSchema, required: true },
  },
  { _id: false },
)

// ── Main schema ──────────────────────────────────────────────────────────────

const workCenterSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ['physical', 'virtual'],
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
    },
    parentWorkCenterId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    props: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    shiftIds: {
      type: [Schema.Types.ObjectId],
      default: [],
    },

    // ── Physical-only fields ─────────────────────────────────────────────────
    productivityMode: {
      type: String,
      enum: ['count_based', 'speed_based'],
      default: null,
    },
    tagBindings: {
      type: tagBindingsSchema,
      default: null,
    },
    attentionSignalTagId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    actionSettings: {
      type: actionSettingsSchema,
      default: null,
    },
    microStopThresholdMs: {
      type: Number,
      default: 0,
    },

    // ── Virtual-only fields ──────────────────────────────────────────────────
    metricComposition: {
      type: metricCompositionSchema,
      default: null,
    },

    // ── Audit ────────────────────────────────────────────────────────────────
    createdBy: { type: String, required: true },
    updatedBy: { type: String, required: true },
  },
  {
    timestamps: true,
    strict: true,
  },
)

// ── Indexes ──────────────────────────────────────────────────────────────────

workCenterSchema.index({ status: 1, type: 1 })

// ── Virtuals & serialization ─────────────────────────────────────────────────

workCenterSchema.set('toObject', { virtuals: true })
workCenterSchema.set('toJSON', { virtuals: true })

// ── Type export ──────────────────────────────────────────────────────────────

export type IWorkCenter = InferSchemaType<typeof workCenterSchema> & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

// ── Plugin ───────────────────────────────────────────────────────────────────

workCenterSchema.plugin(auditLogPlugin)

const WorkCenter = model<IWorkCenter>('WorkCenter', workCenterSchema)
export default WorkCenter
