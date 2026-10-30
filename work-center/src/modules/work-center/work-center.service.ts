import { type PaginationInput, paginate } from '@mes/core/pagination'
import { Types } from 'mongoose'
import type { z } from 'zod'
import { CustomError } from '../../core/errors/index.js'
import {
  emitHierarchyChanged,
  emitMetricCompositionChanged,
  emitWorkCenterArchived,
  emitWorkCenterCreated,
  emitWorkCenterDeleted,
  emitWorkCenterReactivated,
  emitWorkCenterUpdated,
} from '../../jobs/events.js'
import { addWorkCenterToUser, isWorkCenterReferencedByUsers } from '../../lib/internal-api.js'
import { logger } from '../../lib/logger.js'
import { hasAnyCheckInRecords, hasOpenCheckIns } from '../operators/operators.service.js'
import { hasActiveCalendars } from '../schedule/schedule.service.js'
import { Shift } from '../shift/shift.model.js'
import { assertNoOverlap, type ShiftLike } from '../shift/shift.utils.js'
import WorkCenter, { type IWorkCenter } from './work-center.model.js'
import type { CreateWorkCenterInput, PatchWorkCenterInput } from './work-center.validators.js'
import {
  metricCompositionSchema,
  physicalReplaceSchema,
  virtualReplaceSchema,
} from './work-center.validators.js'

// ── Type enforcement helpers ─────────────────────────────────────────────────

const PHYSICAL_ONLY_FIELDS = new Set(['productivityMode', 'tagBindings', 'microStopThresholdMs'])

const VIRTUAL_ONLY_FIELDS = new Set(['metricComposition', 'partialMetricComposition'])

function assertPhysicalOnly(type: string, fieldName: string): void {
  if (type !== 'physical') {
    throw new CustomError(400, 'work_center.physical_field_on_virtual', { field: fieldName })
  }
}

function assertVirtualOnly(type: string, fieldName: string): void {
  if (type !== 'virtual') {
    throw new CustomError(400, 'work_center.virtual_field_on_physical', { field: fieldName })
  }
}

function assertActive(wc: IWorkCenter): void {
  if (wc.status !== 'active') {
    throw new CustomError(400, 'work_center.must_be_active')
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function assertUniqueCode(code: string, excludeId?: string): Promise<void> {
  const filter: Record<string, unknown> = { code }
  if (excludeId) filter._id = { $ne: excludeId }
  const existing = await WorkCenter.findOne(filter).select('_id').lean()
  if (existing) throw new CustomError(409, 'work_center.code_in_use')
}

async function assertUniqueName(name: string, excludeId?: string): Promise<void> {
  const filter: Record<string, unknown> = { name }
  if (excludeId) filter._id = { $ne: excludeId }
  const existing = await WorkCenter.findOne(filter).select('_id').lean()
  if (existing) throw new CustomError(409, 'work_center.name_in_use')
}

function enforceTypeFields(type: string, data: Record<string, unknown>): void {
  for (const key of Object.keys(data)) {
    if (PHYSICAL_ONLY_FIELDS.has(key)) assertPhysicalOnly(type, key)
    if (VIRTUAL_ONLY_FIELDS.has(key)) assertVirtualOnly(type, key)
  }
}

async function validateShiftIdsAssignment(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const unique = Array.from(new Set(ids.map(String)))
  if (unique.length !== ids.length) {
    throw new CustomError(400, 'shift.duplicate_in_assignment')
  }
  const docs = (await Shift.find({ _id: { $in: unique } })
    .select('_id startHour startMinute endHour endMinute')
    .lean()) as Array<ShiftLike>
  if (docs.length !== unique.length) {
    throw new CustomError(404, 'shift.not_found')
  }
  assertNoOverlap(docs)
}

// ── Metric composition validation ───────────────────────────────────────────

type MetricCompositionInput = z.infer<typeof metricCompositionSchema>
const COMPOSITION_FAMILIES = ['availability', 'productivity', 'quality'] as const

export async function validateMetricComposition(
  workCenterId: string | null,
  composition: MetricCompositionInput,
): Promise<void> {
  const allContributorIds = new Set<string>()
  for (const family of COMPOSITION_FAMILIES) {
    for (const c of composition[family].contributors) {
      allContributorIds.add(c.workCenterId)
    }
  }

  if (workCenterId && allContributorIds.has(workCenterId)) {
    throw new CustomError(400, 'work_center.contributor_cannot_be_self')
  }

  const contributors = await WorkCenter.find({ _id: { $in: [...allContributorIds] } })
    .select('_id type status metricComposition')
    .lean()

  const foundMap = new Map(contributors.map(c => [String(c._id), c]))

  for (const cId of allContributorIds) {
    const contributor = foundMap.get(cId)
    if (!contributor) {
      throw new CustomError(404, 'work_center.contributor_not_found', { workCenterId: cId })
    }
    if (contributor.status !== 'active') {
      throw new CustomError(400, 'work_center.contributor_not_active', { workCenterId: cId })
    }
    if (contributor.type === 'virtual' && !contributor.metricComposition) {
      throw new CustomError(400, 'work_center.virtual_contributor_no_composition', {
        workCenterId: cId,
      })
    }
  }

  if (workCenterId) {
    await detectCompositionCycle(workCenterId, allContributorIds)
  }
}

async function detectCompositionCycle(
  targetId: string,
  directContributorIds: Set<string>,
): Promise<void> {
  const visited = new Set<string>()
  let currentLevel = [...directContributorIds]

  while (currentLevel.length > 0) {
    const toFetch = currentLevel.filter(id => !visited.has(id))
    if (toFetch.length === 0) break

    for (const id of toFetch) visited.add(id)

    const wcs = await WorkCenter.find({
      _id: { $in: toFetch },
      type: 'virtual',
      metricComposition: { $ne: null },
    })
      .select('metricComposition')
      .lean()

    const nextLevel: string[] = []
    for (const wc of wcs) {
      if (!wc.metricComposition) continue
      const comp = wc.metricComposition as unknown as MetricCompositionInput
      for (const family of COMPOSITION_FAMILIES) {
        for (const c of comp[family].contributors) {
          const cId = String(c.workCenterId)
          if (cId === targetId) {
            throw new CustomError(400, 'work_center.composition_cycle')
          }
          if (!visited.has(cId)) {
            nextLevel.push(cId)
          }
        }
      }
    }

    currentLevel = nextLevel
  }
}

async function assertNotReferencedAsContributor(workCenterId: string): Promise<void> {
  const count = await WorkCenter.countDocuments({
    $or: [
      { 'metricComposition.availability.contributors.workCenterId': workCenterId },
      { 'metricComposition.productivity.contributors.workCenterId': workCenterId },
      { 'metricComposition.quality.contributors.workCenterId': workCenterId },
    ],
  })
  if (count > 0) {
    throw new CustomError(409, 'work_center.composition_referenced')
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function createWorkCenter(
  data: CreateWorkCenterInput,
  userId: string,
): Promise<IWorkCenter> {
  await assertUniqueCode(data.code)
  await assertUniqueName(data.name)

  if (data.parentWorkCenterId) {
    await validateParent(null, data.parentWorkCenterId)
  }

  if (data.type === 'virtual' && data.metricComposition) {
    await validateMetricComposition(null, data.metricComposition)
  }

  if (data.shiftIds && data.shiftIds.length > 0) {
    await validateShiftIdsAssignment(data.shiftIds.map(String))
  }

  const doc = new WorkCenter({
    ...data,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  })

  const saved = await doc.save()

  await emitWorkCenterCreated(String(saved._id))
  if (data.type === 'virtual' && data.metricComposition) {
    await emitMetricCompositionChanged(String(saved._id))
  }

  // Best-effort, but awaited: the creator can use the work center once this request returns
  await addWorkCenterToUser(userId, String(saved._id))

  return saved
}

export async function getWorkCenter(
  id: string,
  visibleIds?: string[] | null,
): Promise<IWorkCenter> {
  const wc = await WorkCenter.findById(id).select('-__v').lean()
  if (!wc) throw new CustomError(404, 'work_center.not_found')

  // Visibility: if filter provided, user must have access
  if (visibleIds && !visibleIds.includes(String(wc._id))) {
    throw new CustomError(404, 'work_center.not_found')
  }

  return wc as IWorkCenter
}

export async function getWorkCenters(
  input: PaginationInput & {
    type?: string
    status?: string
    parentWorkCenterId?: string | null
  },
  visibleIds?: string[] | null,
) {
  const { type, status, parentWorkCenterId, ...pagination } = input
  const filters: Record<string, unknown> = {}

  if (type) filters.type = type
  if (status) filters.status = status
  if (parentWorkCenterId !== undefined) filters.parentWorkCenterId = parentWorkCenterId

  // Visibility: restrict to user's workCenterIds
  if (visibleIds) {
    filters._id = { $in: visibleIds }
  }

  return paginate(WorkCenter, filters, pagination, {
    searchFields: ['code', 'name'],
    allowedSortFields: ['code', 'name', 'type', 'status', 'createdAt', 'updatedAt'],
  })
}

export async function replaceWorkCenter(
  id: string,
  data: Record<string, unknown>,
  userId: string,
): Promise<IWorkCenter> {
  const existing = await WorkCenter.findById(id)
  if (!existing) throw new CustomError(404, 'work_center.not_found')

  assertActive(existing)

  // Validate body against the correct type-specific schema
  const parsed =
    existing.type === 'physical'
      ? physicalReplaceSchema.parse(data)
      : virtualReplaceSchema.parse(data)

  if (parsed.code !== existing.code) {
    await assertUniqueCode(parsed.code, id)
  }
  if (parsed.name !== existing.name) {
    await assertUniqueName(parsed.name, id)
  }

  const oldParentId = existing.parentWorkCenterId ? String(existing.parentWorkCenterId) : null
  const newParentId = parsed.parentWorkCenterId ?? null

  if (newParentId && newParentId !== oldParentId) {
    await validateParent(id, newParentId)
  }

  // Validate metric composition for virtual WCs
  if (existing.type === 'virtual' && 'metricComposition' in parsed) {
    if (parsed.metricComposition === null) {
      if (existing.metricComposition) {
        await assertNotReferencedAsContributor(id)
      }
    } else if (parsed.metricComposition) {
      await validateMetricComposition(id, parsed.metricComposition)
    }
  }

  Object.assign(existing, parsed)
  existing.updatedBy = new Types.ObjectId(userId)

  const saved = await existing.save()

  if (newParentId !== oldParentId) {
    await emitHierarchyChanged(id, oldParentId, newParentId)
  }
  await emitWorkCenterUpdated(id)
  if (existing.type === 'virtual' && 'metricComposition' in parsed) {
    await emitMetricCompositionChanged(id)
  }

  return saved
}

export async function updateWorkCenter(
  id: string,
  data: PatchWorkCenterInput,
  userId: string,
): Promise<IWorkCenter> {
  const existing = await WorkCenter.findById(id)
  if (!existing) throw new CustomError(404, 'work_center.not_found')

  // Type field is immutable
  if ('type' in data) {
    throw new CustomError(400, 'work_center.type_immutable')
  }

  const { status, partialMetricComposition, ...updateFields } = data

  // Lifecycle transitions: if status is changing, handle separately and return
  if (status !== undefined && status !== existing.status) {
    if (status === 'archived') {
      return archiveWorkCenter(id, existing, userId)
    }
    if (status === 'active') {
      return reactivateWorkCenter(id, existing, userId)
    }
  }

  // Reject wrong-type fields
  enforceTypeFields(existing.type, updateFields)

  // partialMetricComposition is destructured separately — check type manually
  if (partialMetricComposition) {
    assertVirtualOnly(existing.type, 'partialMetricComposition')
  }

  // Active-status guard for business field updates
  if (Object.keys(updateFields).length > 0 || partialMetricComposition) {
    assertActive(existing)
  }

  // Validate unique code/name if changed
  if (updateFields.code && updateFields.code !== existing.code) {
    await assertUniqueCode(updateFields.code, id)
  }
  if (updateFields.name && updateFields.name !== existing.name) {
    await assertUniqueName(updateFields.name, id)
  }

  // Validate tagBindings cross-field rules for physical
  if (existing.type === 'physical') {
    const finalProductivityMode = updateFields.productivityMode ?? existing.productivityMode
    const finalTagBindings = updateFields.tagBindings ?? existing.tagBindings
    const hasCounter = !!finalTagBindings?.productionCounterTagId
    const hasSpeed = !!finalTagBindings?.speedTagId

    if (finalProductivityMode === 'count_based' && (!hasCounter || hasSpeed)) {
      throw new CustomError(400, 'work_center.exactly_one_productivity_tag_required')
    }

    if (finalProductivityMode === 'speed_based' && (!hasSpeed || hasCounter)) {
      throw new CustomError(400, 'work_center.exactly_one_productivity_tag_required')
    }
  }

  // Validate metric composition for virtual WCs
  let compositionChanged = false

  if (existing.type === 'virtual') {
    if ('metricComposition' in updateFields && partialMetricComposition) {
      throw new CustomError(400, 'work_center.composition_conflicts_with_partial')
    }

    // Full composition replacement
    if ('metricComposition' in updateFields) {
      if (updateFields.metricComposition == null) {
        if (existing.metricComposition) {
          await assertNotReferencedAsContributor(id)
        }
      } else {
        await validateMetricComposition(id, updateFields.metricComposition)
      }
      compositionChanged = true
    }

    // Partial composition merge (per-family)
    if (partialMetricComposition) {
      if (!existing.metricComposition) {
        throw new CustomError(400, 'work_center.partial_requires_existing_composition')
      }
      const existingComp = JSON.parse(JSON.stringify(existing.metricComposition))
      const merged = metricCompositionSchema.parse({
        ...existingComp,
        ...partialMetricComposition,
      })
      await validateMetricComposition(id, merged)
      existing.set('metricComposition', merged)
      compositionChanged = true
    }
  }

  // Validate shiftIds if provided
  if (updateFields.shiftIds !== undefined) {
    await validateShiftIdsAssignment(updateFields.shiftIds.map(String))
  }

  // Handle parentWorkCenterId change
  const oldParentId = existing.parentWorkCenterId ? String(existing.parentWorkCenterId) : null

  if ('parentWorkCenterId' in updateFields) {
    const newParentId = updateFields.parentWorkCenterId ?? null
    if (newParentId && newParentId !== oldParentId) {
      await validateParent(id, newParentId)
    }
  }

  // Apply updates
  for (const [key, value] of Object.entries(updateFields)) {
    ;(existing as unknown as Record<string, unknown>)[key] = value
  }
  existing.updatedBy = new Types.ObjectId(userId)

  const saved = await existing.save()

  // Emit hierarchy event if parent changed
  if ('parentWorkCenterId' in updateFields) {
    const newParentId = updateFields.parentWorkCenterId ?? null
    if (newParentId !== oldParentId) {
      await emitHierarchyChanged(id, oldParentId, newParentId)
    }
  }

  await emitWorkCenterUpdated(id)
  if (compositionChanged) {
    await emitMetricCompositionChanged(id)
  }

  return saved
}

// ── Hierarchy validation ─────────────────────────────────────────────────────

export async function validateParent(workCenterId: string | null, parentId: string): Promise<void> {
  const parent = await WorkCenter.findById(parentId).select('type status _id').lean()
  if (!parent) throw new CustomError(404, 'work_center.parent_not_found')
  if (parent.type !== 'virtual') {
    throw new CustomError(400, 'work_center.parent_must_be_virtual')
  }
  if (parent.status !== 'active') {
    throw new CustomError(400, 'work_center.parent_must_be_active')
  }

  if (workCenterId) {
    if (String(parent._id) === workCenterId) {
      throw new CustomError(400, 'work_center.cannot_be_own_parent')
    }

    // Cycle check: ensure parentId is not a descendant of workCenterId
    const [result] = await WorkCenter.aggregate([
      { $match: { _id: WorkCenter.castObject({ _id: workCenterId })._id } },
      {
        $graphLookup: {
          from: 'workcenters',
          startWith: '$_id',
          connectFromField: '_id',
          connectToField: 'parentWorkCenterId',
          as: 'descendants',
          maxDepth: 100,
        },
      },
      { $project: { descendantIds: '$descendants._id' } },
    ])

    const descendantIds = (result?.descendantIds ?? []).map(String)
    if (descendantIds.includes(parentId)) {
      throw new CustomError(400, 'work_center.circular_hierarchy')
    }
  }
}

// ── Hierarchy orphaning ──────────────────────────────────────────────────────

/**
 * Nullifies parentWorkCenterId for all direct children of the given work center.
 * Used when a virtual work center is archived or hard-deleted.
 * Returns the ids of orphaned children (for per-child event emission).
 */
export async function orphanChildren(
  workCenterId: string,
  session?: import('mongoose').ClientSession,
): Promise<string[]> {
  const children = await WorkCenter.find({ parentWorkCenterId: workCenterId }).select('_id').lean()

  if (children.length === 0) return []

  await WorkCenter.updateMany(
    { parentWorkCenterId: workCenterId },
    { $set: { parentWorkCenterId: null } },
    session ? { session } : undefined,
  )

  return children.map(c => String(c._id))
}

// ── Lifecycle transitions ─────────────────────────────────────────────────────

async function archiveWorkCenter(
  id: string,
  existing: InstanceType<typeof WorkCenter>,
  userId: string,
): Promise<IWorkCenter> {
  assertActive(existing)

  // Guard: referenced as contributor
  await assertNotReferencedAsContributor(id)

  if (existing.type === 'physical') {
    // Guard: open check-ins
    if (await hasOpenCheckIns(id)) {
      throw new CustomError(400, 'work_center.archive_blocked_open_checkins')
    }
  }

  if (existing.type === 'virtual') {
    // Orphan children
    const orphanedIds = await orphanChildren(id)
    // Clear composition
    existing.set('metricComposition', null)
    // Emit per-orphan events
    for (const childId of orphanedIds) {
      await emitWorkCenterUpdated(childId)
    }
  }

  existing.status = 'archived'
  existing.updatedBy = new Types.ObjectId(userId)
  const saved = await existing.save()

  await emitWorkCenterArchived(id)
  return saved
}

async function reactivateWorkCenter(
  id: string,
  existing: InstanceType<typeof WorkCenter>,
  userId: string,
): Promise<IWorkCenter> {
  if (existing.status !== 'archived') {
    throw new CustomError(400, 'work_center.must_be_archived')
  }

  existing.status = 'active'
  existing.updatedBy = new Types.ObjectId(userId)
  const saved = await existing.save()

  await emitWorkCenterReactivated(id)
  return saved
}

export async function hardDeleteWorkCenter(id: string): Promise<void> {
  const existing = await WorkCenter.findById(id)
  if (!existing) throw new CustomError(404, 'work_center.not_found')

  // Guard: referenced as contributor
  await assertNotReferencedAsContributor(id)

  // Guard: active calendars
  if (await hasActiveCalendars(id)) {
    throw new CustomError(400, 'work_center.delete_blocked_active_calendars')
  }

  // Guard: user-service reference
  if (await isWorkCenterReferencedByUsers(id)) {
    throw new CustomError(400, 'work_center.delete_blocked_user_reference')
  }

  if (existing.type === 'physical') {
    // Guard: any check-in records
    if (await hasAnyCheckInRecords(id)) {
      throw new CustomError(400, 'work_center.delete_blocked_checkin_records')
    }
  }

  if (existing.type === 'virtual') {
    const orphanedIds = await orphanChildren(id)
    for (const childId of orphanedIds) {
      await emitWorkCenterUpdated(childId)
    }
  }

  await WorkCenter.deleteOne({ _id: id })
  await emitWorkCenterDeleted(id)
}
