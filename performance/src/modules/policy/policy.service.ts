import { CustomError } from '@mes/core'
import { Types } from 'mongoose'
import { cacheDel, cacheWrap } from '../../lib/cache.js'
import { type IPerformanceRuntimePolicy, PerformanceRuntimePolicy } from './policy.model.js'
import type { PolicyUpdateInput, PolicyWorkCenterUpdateInput } from './policy.validators.js'

const CACHE_TTL_SECONDS = 5 * 60
const FACTORY_KEY = 'policy:factory'
const wcKey = (id: string) => `policy:wc:${id}`

const FACTORY_DEFAULT: Omit<IPerformanceRuntimePolicy, '_id' | 'createdAt' | 'updatedAt'> = {
  workCenterId: null,
  runModeDebounceMs: 0,
  microStopThresholdMs: 120_000,
  actualOutputWindowMode: 'execution_span',
  productivityAggregationMode: 'total_ratio',
  allowProductivityOver100: true,
  updatedBy: null,
}

async function invalidate(workCenterId: string | null): Promise<void> {
  await cacheDel(FACTORY_KEY)
  if (workCenterId) await cacheDel(wcKey(workCenterId))
}

export async function getFactory(): Promise<IPerformanceRuntimePolicy> {
  const cached = await cacheWrap<IPerformanceRuntimePolicy>(
    FACTORY_KEY,
    CACHE_TTL_SECONDS,
    async () => {
      const existing = await PerformanceRuntimePolicy.findOne({
        workCenterId: null,
      }).lean<IPerformanceRuntimePolicy>()
      if (existing) return existing

      return { ...FACTORY_DEFAULT } as IPerformanceRuntimePolicy
    },
  )
  return cached
}

// A work center's row holds only the fields set for it. It is cached apart from the factory, so a
// factory change reaches every work center at once.
async function getWorkCenterRow(workCenterId: string): Promise<Partial<IPerformanceRuntimePolicy>> {
  return cacheWrap<Partial<IPerformanceRuntimePolicy>>(
    wcKey(workCenterId),
    CACHE_TTL_SECONDS,
    async () =>
      (await PerformanceRuntimePolicy.findOne({
        workCenterId: new Types.ObjectId(workCenterId),
      }).lean<IPerformanceRuntimePolicy>()) ?? {},
  )
}

export async function getForWorkCenter(workCenterId: string): Promise<IPerformanceRuntimePolicy> {
  const [factory, row] = await Promise.all([getFactory(), getWorkCenterRow(workCenterId)])
  return { ...factory, ...row }
}

export async function resolveForWorkCenter(
  workCenterId: string,
): Promise<IPerformanceRuntimePolicy> {
  return getForWorkCenter(workCenterId)
}

export async function upsertFactory(
  patch: PolicyUpdateInput,
  userId: string,
): Promise<IPerformanceRuntimePolicy> {
  const doc = await PerformanceRuntimePolicy.findOneAndUpdate(
    { workCenterId: null },
    {
      $set: { ...patch, updatedBy: new Types.ObjectId(userId) },
      $setOnInsert: { workCenterId: null },
    },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
  )
  if (!doc) throw new CustomError(500, 'error.upsert_failed')
  await invalidate(null)
  return doc
}

export async function upsertForWorkCenter(
  workCenterId: string,
  patch: PolicyWorkCenterUpdateInput,
  userId: string,
): Promise<IPerformanceRuntimePolicy> {
  const wcObjectId = new Types.ObjectId(workCenterId)
  // The row stores only the fields set for the work center; the rest come from the factory
  const set: Record<string, unknown> = { updatedBy: new Types.ObjectId(userId) }
  const unset: Record<string, ''> = {}
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) unset[field] = ''
    else set[field] = value
  }
  const doc = await PerformanceRuntimePolicy.findOneAndUpdate(
    { workCenterId: wcObjectId },
    { $set: set, $unset: unset, $setOnInsert: { workCenterId: wcObjectId } },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: false },
  )
  if (!doc) throw new CustomError(500, 'error.upsert_failed')
  await invalidate(workCenterId)
  return getForWorkCenter(workCenterId)
}

export async function removeForWorkCenter(workCenterId: string): Promise<void> {
  const doc = await PerformanceRuntimePolicy.findOneAndDelete({
    workCenterId: new Types.ObjectId(workCenterId),
  })
  if (!doc) throw new CustomError(404, 'error.not_found')
  await invalidate(workCenterId)
}
