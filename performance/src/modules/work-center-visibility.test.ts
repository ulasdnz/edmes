import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/cache.js', () => ({
  cacheDel: vi.fn(async () => {}),
  cacheWrap: vi.fn(async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader()),
  cacheWrapDedup: vi.fn(async (_key: string, _ttl: number, loader: () => Promise<unknown>) =>
    loader(),
  ),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDelPattern: vi.fn(),
  sharedCacheWrapDedup: vi.fn(),
  sharedCacheDel: vi.fn(),
}))

vi.mock('../lib/internal-api/run-mode-telemetry.client.js', () => ({
  getLatest: vi.fn(async () => null),
  getStateDurations: vi.fn(),
}))

vi.mock('../lib/internal-api/work-center.client.js', () => ({
  getById: vi.fn(async () => null),
  invalidate: vi.fn(async () => {}),
}))

import * as plannedStopController from './planned-stop/planned-stop.controller.js'
import { PlannedStop } from './planned-stop/planned-stop.model.js'
import * as scheduleController from './planned-stop-schedule/planned-stop-schedule.controller.js'
import { PlannedStopSchedule } from './planned-stop-schedule/planned-stop-schedule.model.js'
import * as templateController from './planned-stop-template/planned-stop-template.controller.js'
import { PlannedStopTemplate } from './planned-stop-template/planned-stop-template.model.js'
import * as policyController from './policy/policy.controller.js'
import { PerformanceRuntimePolicy } from './policy/policy.model.js'
import * as unplannedStopController from './unplanned-stop/unplanned-stop.controller.js'
import { UnplannedStop } from './unplanned-stop/unplanned-stop.model.js'

// A user may read or change a record only on a work center they can see. For any other work
// center every single record endpoint answers 404, the way the lists leave such records out.

const visibleWc = new Types.ObjectId()
const hiddenWc = new Types.ObjectId()
const userId = new Types.ObjectId()
const notFound = { statusCode: 404 }

// A request from a user who can see visibleWc only
const asUser = (params: Record<string, string>, body: Record<string, unknown> = {}) =>
  ({
    params,
    body,
    user: { id: userId.toString(), roles: [], permissions: [], workCenterIds: [String(visibleWc)] },
    t: (key: string) => key,
  }) as never

const response = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis() })

const plannedStopOn = (workCenterId: Types.ObjectId, overrides: Record<string, unknown> = {}) =>
  PlannedStop.create({
    workCenterId,
    reasonId: new Types.ObjectId(),
    plannedOwnerId: userId,
    source: 'manual',
    startMode: 'manual',
    status: 'planned',
    plannedStartAt: new Date('2026-03-01T08:00:00Z'),
    plannedEndAt: new Date('2026-03-01T09:00:00Z'),
    ...overrides,
  })

const scheduleOn = (workCenterIds: Types.ObjectId[]) =>
  PlannedStopSchedule.create({
    workCenterIds,
    reasonId: new Types.ObjectId(),
    plannedOwnerId: userId,
    name: 'Lunch break',
    occurrenceStartMode: 'automatic',
    recurrence: { frequency: 'daily', timezone: 'Europe/Istanbul', startHour: 12, startMinute: 0 },
    plannedDurationMs: 1_800_000,
    createdBy: userId,
  })

const templateOn = (workCenterIds: Types.ObjectId[]) =>
  PlannedStopTemplate.create({
    workCenterIds,
    reasonId: new Types.ObjectId(),
    name: 'Die change',
    defaultDurationMs: 600_000,
    overrunPolicy: 'alert_only',
    createdBy: userId,
  })

describe('performance endpoints for a work center the caller cannot see', () => {
  it('do not show a planned stop', async () => {
    const stop = await plannedStopOn(hiddenWc)

    await expect(
      plannedStopController.getById(asUser({ id: String(stop._id) }), response() as never),
    ).rejects.toMatchObject(notFound)
  })

  it('do not show an unplanned stop', async () => {
    const stop = await UnplannedStop.create({
      workCenterId: hiddenWc,
      source: 'manual',
      startAt: new Date('2026-03-01T08:00:00Z'),
    })

    await expect(
      unplannedStopController.getById(asUser({ id: String(stop._id) }), response() as never),
    ).rejects.toMatchObject(notFound)
  })

  it('do not show, change or delete a planned stop schedule', async () => {
    const schedule = await scheduleOn([hiddenWc])
    const params = { id: String(schedule._id) }

    await expect(
      scheduleController.getById(asUser(params), response() as never),
    ).rejects.toMatchObject(notFound)
    await expect(
      scheduleController.update(asUser(params, { name: 'Taken over' }), response() as never),
    ).rejects.toMatchObject(notFound)
    await expect(
      scheduleController.remove(asUser(params), response() as never),
    ).rejects.toMatchObject(notFound)
    expect(await PlannedStopSchedule.findById(schedule._id).lean()).toMatchObject({
      name: 'Lunch break',
    })
  })

  it('do not show, change or delete a planned stop template, nor close a stop started from it', async () => {
    const template = await templateOn([hiddenWc])
    const params = { id: String(template._id) }
    const stop = await plannedStopOn(hiddenWc, {
      source: 'template',
      templateId: template._id,
      status: 'active',
      actualStartAt: new Date('2026-03-01T08:00:00Z'),
    })

    await expect(
      templateController.getById(asUser(params), response() as never),
    ).rejects.toMatchObject(notFound)
    await expect(
      templateController.update(asUser(params, { name: 'Taken over' }), response() as never),
    ).rejects.toMatchObject(notFound)
    await expect(
      templateController.closeFromTemplate(
        asUser(params, { plannedStopId: String(stop._id) }),
        response() as never,
      ),
    ).rejects.toMatchObject(notFound)
    await expect(
      templateController.remove(asUser(params), response() as never),
    ).rejects.toMatchObject(notFound)
    expect(await PlannedStopTemplate.findById(template._id).lean()).toMatchObject({
      name: 'Die change',
    })
    expect(await PlannedStop.findById(stop._id).lean()).toMatchObject({ status: 'active' })
  })

  it('do not show, change or delete its performance policy', async () => {
    await PerformanceRuntimePolicy.create({
      workCenterId: hiddenWc,
      actualOutputWindowMode: 'net_run_segments',
    })
    const params = { workCenterId: String(hiddenWc) }

    await expect(
      policyController.getForWorkCenter(asUser(params), response() as never),
    ).rejects.toMatchObject(notFound)
    await expect(
      policyController.updateForWorkCenter(
        asUser(params, { actualOutputWindowMode: 'execution_span' }),
        response() as never,
      ),
    ).rejects.toMatchObject(notFound)
    await expect(
      policyController.removeForWorkCenter(asUser(params), response() as never),
    ).rejects.toMatchObject(notFound)
    expect(await PerformanceRuntimePolicy.findOne({ workCenterId: hiddenWc }).lean()).toMatchObject(
      { actualOutputWindowMode: 'net_run_segments' },
    )
  })
})

describe('a planned stop schedule on several work centers', () => {
  it('shows to a user who can see any of them, as the list does', async () => {
    const schedule = await scheduleOn([visibleWc, hiddenWc])
    const res = response()

    await scheduleController.getById(asUser({ id: String(schedule._id) }), res as never)

    expect(res.json).toHaveBeenCalledOnce()
  })

  it('can be changed or deleted only by a user who can see all of them', async () => {
    const schedule = await scheduleOn([visibleWc, hiddenWc])
    const params = { id: String(schedule._id) }

    await expect(
      scheduleController.update(
        asUser(params, { workCenterIds: [String(visibleWc)] }),
        response() as never,
      ),
    ).rejects.toMatchObject(notFound)
    await expect(
      scheduleController.remove(asUser(params), response() as never),
    ).rejects.toMatchObject(notFound)
    expect((await PlannedStopSchedule.findById(schedule._id).lean())?.workCenterIds).toHaveLength(2)
  })
})
