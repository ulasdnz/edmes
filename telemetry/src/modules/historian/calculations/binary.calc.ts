import { getHistorianCollection } from '../../ingestion/historian.repository.js'

interface BinaryDoc {
  occurredAt: Date
  value: number
}

export interface StateSegment {
  state: number
  start: Date
  end: Date
  durationMs: number
}

export interface StateDurationsResult {
  segments: StateSegment[]
  hasMore: boolean
  nextCursor: Date | null
}

export interface StateDurationsOptions {
  /**
   * Maximum number of source samples to fetch from DB. When the underlying sample
   * count exceeds `limit`, the response is truncated and `hasMore` + `nextCursor`
   * let the caller continue. Same-value samples are dropped at ingestion
   * (`ingestion.pipeline.ts` line 93), so sample count ≡ transition count for binary
   * tags — `limit` effectively caps transitions per chunk.
   */
  limit?: number
  /**
   * Inclusive ($gte) lower bound for the in-window query, used by paginated callers
   * to resume after a previous chunk's `nextCursor`. Falls back to `rangeStart`.
   *
   * Inclusive on purpose: the sample at exactly `after` is needed so the algorithm's
   * baseline + first-doc transition logic does not lose state at the chunk boundary.
   * Duplicate-skip is the caller's responsibility (e.g. `handleRunModeSample`'s
   * cursor guard in the run-mode reconciler).
   */
  after?: Date
}

export const calculateStateDurations = async (
  tagId: string,
  rangeStart: Date,
  rangeEnd: Date,
  opts?: StateDurationsOptions,
): Promise<StateDurationsResult> => {
  const collection = getHistorianCollection(tagId)
  // Clamp `after` to never reach earlier than rangeStart: a caller-supplied
  // `after` outside the requested range must not widen the effective query.
  const effectiveFrom =
    opts?.after && opts.after.getTime() > rangeStart.getTime() ? opts.after : rangeStart
  // Defensive minimum of 2 mirrors the validator's schema constraint: with
  // after-inclusive pagination, limit=1 would stall on the boundary sample.
  // Direct (non-HTTP) callers get the same guarantee here.
  const limit = opts?.limit !== undefined ? Math.max(2, opts.limit) : undefined

  const baseline = await collection.findOne<BinaryDoc>(
    { occurredAt: { $lt: effectiveFrom } },
    { sort: { occurredAt: -1, _id: -1 } },
  )

  let findCursor = collection
    .find<BinaryDoc>({ occurredAt: { $gte: effectiveFrom, $lt: rangeEnd } })
    .sort({ occurredAt: 1, _id: 1 })
  if (limit !== undefined) findCursor = findCursor.limit(limit + 1)
  const fetched = await findCursor.toArray()

  const hasMore = limit !== undefined && fetched.length > limit
  const docs = hasMore ? fetched.slice(0, limit) : fetched

  if (!baseline && docs.length === 0) {
    return { segments: [], hasMore, nextCursor: null }
  }

  const segments: StateSegment[] = []
  let currentState: number
  let segmentStart: Date
  let startIdx: number

  if (baseline) {
    currentState = baseline.value
    segmentStart = effectiveFrom
    startIdx = 0
  } else {
    currentState = docs[0].value
    segmentStart = docs[0].occurredAt
    startIdx = 1
  }

  for (let i = startIdx; i < docs.length; i++) {
    const doc = docs[i]
    if (doc.value !== currentState) {
      const durationMs = doc.occurredAt.getTime() - segmentStart.getTime()
      if (durationMs > 0) {
        segments.push({
          state: currentState,
          start: segmentStart,
          end: doc.occurredAt,
          durationMs,
        })
      }
      currentState = doc.value
      segmentStart = doc.occurredAt
    }
  }

  // hasMore=false: close the final (still-open) segment at rangeEnd (mevcut davranış).
  // hasMore=true: drop the in-progress final segment. The next chunk reconstructs
  // it from baseline ($lt nextCursor) plus the first sample at `after = nextCursor`.
  // Segment shape stays meaningful (no fictional rangeEnd values).
  if (!hasMore) {
    const finalDurationMs = rangeEnd.getTime() - segmentStart.getTime()
    if (finalDurationMs > 0) {
      segments.push({
        state: currentState,
        start: segmentStart,
        end: rangeEnd,
        durationMs: finalDurationMs,
      })
    }
  }

  const nextCursor = hasMore ? docs[docs.length - 1].occurredAt : null
  return { segments, hasMore, nextCursor }
}
