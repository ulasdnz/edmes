import { CustomError } from '../../core/errors/index.js'
import { emitActionStateChanged } from '../../jobs/events.js'
import WorkCenter from '../work-center/work-center.model.js'
import { ActionState, type IActionState } from './action-state.model.js'
import type { IngestActionStateInput } from './action-state.validators.js'

// ── Ingest ──────────────────────────────────────────────────────────────────

export async function ingestActionState(
  workCenterId: string,
  data: IngestActionStateInput,
  userId: string,
): Promise<IActionState> {
  const wc = await WorkCenter.findById(workCenterId).select('type status').lean()
  if (!wc) throw new CustomError(404, 'work_center.not_found')
  if (wc.type !== 'physical') throw new CustomError(400, 'work_center.must_be_physical')
  if (wc.status !== 'active') throw new CustomError(400, 'work_center.must_be_active')

  const sorted = [...data.activeActions].sort()

  // Idempotency: skip if latest snapshot has the same action set
  const latest = await ActionState.findOne({ workCenterId }).sort({ changedAt: -1 }).lean()
  if (latest) {
    const latestSorted = [...latest.activeActions].sort()
    if (JSON.stringify(sorted) === JSON.stringify(latestSorted)) {
      return latest as IActionState
    }
  }

  const doc = new ActionState({
    workCenterId,
    changedAt: new Date(),
    activeActions: sorted,
    createdBy: userId,
  })
  const saved = await doc.save()
  await emitActionStateChanged(workCenterId)
  return saved
}

// ── Query ───────────────────────────────────────────────────────────────────

export async function getLatestActionState(workCenterId: string): Promise<IActionState | null> {
  const wc = await WorkCenter.findById(workCenterId).select('_id type').lean()
  if (!wc) throw new CustomError(404, 'work_center.not_found')
  if (wc.type !== 'physical') throw new CustomError(400, 'work_center.must_be_physical')

  const latest = await ActionState.findOne({ workCenterId }).sort({ changedAt: -1 }).lean()
  return latest as IActionState | null
}

// ── Lifecycle helpers ───────────────────────────────────────────────────────

export async function internalClearActionState(workCenterId: string): Promise<void> {
  const latest = await ActionState.findOne({ workCenterId }).sort({ changedAt: -1 }).lean()
  if (!latest || latest.activeActions.length === 0) return

  const doc = new ActionState({
    workCenterId,
    changedAt: new Date(),
    activeActions: [],
    createdBy: 'system',
  })
  await doc.save()
  await emitActionStateChanged(workCenterId)
}

export async function hasNonEmptyActionState(workCenterId: string): Promise<boolean> {
  const count = await ActionState.countDocuments({
    workCenterId,
    activeActions: { $ne: [] },
  })
  return count > 0
}
