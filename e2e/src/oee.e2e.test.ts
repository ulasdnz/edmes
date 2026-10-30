import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, inject, it } from 'vitest'
import { Api, eventually, loginAsAdmin } from './support/api.js'
import { publishSamples } from './support/plc.js'

type Created = { _id: string }
type PressLine = Awaited<ReturnType<typeof createPressLine>>

// A count based press: a stroke counter and a run-mode signal bound to its PLC, a shift, the
// work center and a product, all named after the work center code.
async function createPressLine(api: Api, code: string) {
  const deviceKey = code.toLowerCase()
  const tagType = await api.post<Created>('telemetry', '/api/v1/tag-types', {
    name: `${code} signals`,
  })
  const strokes = await api.post<Created>('telemetry', '/api/v1/tags', {
    name: `${code} strokes`,
    tagTypeId: tagType._id,
    behavior: 'counter',
    binding: { deviceKey, nodeId: 'strokes' },
  })
  const runMode = await api.post<Created>('telemetry', '/api/v1/tags', {
    name: `${code} run mode`,
    tagTypeId: tagType._id,
    behavior: 'binary',
    binding: { deviceKey, nodeId: 'run' },
  })
  const shift = await api.post<Created>('work-center', '/api/v1/shifts', {
    name: `${code} day`,
    startHour: 0,
    startMinute: 0,
    endHour: 23,
    endMinute: 59,
  })
  const press = await api.post<Created>('work-center', '/api/v1/work-centers', {
    code,
    name: code,
    type: 'physical',
    productivityMode: 'count_based',
    tagBindings: { runModeTagId: runMode._id, productionCounterTagId: strokes._id },
    shiftIds: [shift._id],
  })
  const uom = await api.post<Created>('production', '/api/v1/uoms', {
    code: `${code}-PCS`,
    name: `${code} piece`,
    symbol: 'pcs',
  })
  const product = await api.post<Created>('production', '/api/v1/products', {
    code: `${code}-PART`,
    name: `${code} part`,
    kind: 'finished',
    uomId: uom._id,
  })
  return { deviceKey, strokes, shift, press, product }
}

function createStandard(
  api: Api,
  line: PressLine,
  validFrom: Date,
  idealOutputPerMinute: number,
  counterMultiplier: number,
  backdateReason?: string,
) {
  return api.post('production', '/api/v1/product-standards', {
    productId: line.product._id,
    workCenterId: line.press._id,
    validFrom: validFrom.toISOString(),
    idealOutputPerMinute,
    counterMultiplier,
    backdateReason,
  })
}

async function startJobOrder(api: Api, line: PressLine, code: string, start: Date) {
  const jobOrder = await api.post<Created>('production', '/api/v1/job-orders', {
    code,
    productId: line.product._id,
    workCenterId: line.press._id,
    targetQuantity: 1000,
  })
  await api.post('production', `/api/v1/job-orders/${jobOrder._id}/start`, {
    startTime: start.toISOString(),
  })
  return jobOrder
}

// The PLC stroke counter goes up by one every 6 seconds, 10 strokes a minute.
function publishStrokes(line: PressLine, from: Date, to: Date) {
  const strokes = (to.getTime() - from.getTime()) / 6000
  return publishSamples(
    line.deviceKey,
    'strokes',
    Array.from({ length: strokes + 1 }, (_, k) => ({
      value: 1000 + k,
      time: new Date(from.getTime() + k * 6000),
    })),
  )
}

function scrap(api: Api, line: PressLine, jobOrder: Created, amount: number, from: Date, to: Date) {
  return api.post('production', '/api/v1/scrap-entries', {
    jobOrderId: jobOrder._id,
    shiftId: line.shift._id,
    amount,
    startTime: from.toISOString(),
    endTime: to.toISOString(),
  })
}

// Telemetry ingests MQTT messages asynchronously.
function strokesIngested(line: PressLine, from: Date, to: Date, total: number) {
  return eventually(
    () =>
      Api.internal().post<{ total: number }>(
        'telemetry',
        `/internal/v1/historian/${line.strokes._id}/produced-summary`,
        { windows: [{ from: from.toISOString(), to: to.toISOString() }] },
      ),
    summary => summary.total === total,
  )
}

function oeeOf(api: Api, workCenterId: string, from: Date, to: Date) {
  const query = new URLSearchParams({
    workCenterId,
    from: from.toISOString(),
    to: to.toISOString(),
  })
  return api.get('performance', `/api/v1/oee?${query}`)
}

describe('OEE across telemetry, work-center, production and performance', () => {
  // A press stamps 4 parts per stroke and its ideal rate is 40 parts a minute. In one minute the
  // PLC counts 10 strokes (40 parts) and the operator scraps 10 of them.
  it('count based: reports 100% productivity and 75% quality for 40 parts with 10 scrapped', async () => {
    const { api } = await loginAsAdmin()
    const start = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 10 * 60_000)
    const end = new Date(start.getTime() + 60_000)
    const line = await createPressLine(api, 'PRESS-01')
    await createStandard(api, line, new Date(start.getTime() - 3_600_000), 40, 4)
    const jobOrder = await startJobOrder(api, line, 'JO-E2E-001', start)

    await publishStrokes(line, start, end)
    await scrap(api, line, jobOrder, 10, start, end)
    await strokesIngested(line, start, end, 10)

    expect(await oeeOf(api, line.press._id, start, end)).toMatchObject({
      availability: { percentage: 100, status: 'ok' },
      productivity: { percentage: 100, status: 'ok' },
      quality: { percentage: 75, status: 'ok' },
      oee: { percentage: 75, status: 'ok' },
    })
  })

  // In the middle of a job order some die holes close, so each stroke stamps 2 parts instead of
  // 4, and later they open again; each change is a new standard. Over three minutes at 10 strokes
  // a minute the press makes 40 + 20 + 40 = 100 parts against a 100 part target, and 25 parts are
  // scrapped.
  it('count based: converts each minute with the standard valid at that time (4, 2, 4 per stroke)', async () => {
    const { api } = await loginAsAdmin()
    const start = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 10 * 60_000)
    const minute = (n: number) => new Date(start.getTime() + n * 60_000)
    const line = await createPressLine(api, 'PRESS-02')
    // The test replays the past, so the standards that take effect during the job order are set
    // before it starts: once production is measured, no new standard can be dated into it.
    await createStandard(api, line, new Date(start.getTime() - 3_600_000), 40, 4)
    await createStandard(api, line, minute(1), 20, 2)
    await createStandard(api, line, minute(2), 40, 4)
    const jobOrder = await startJobOrder(api, line, 'JO-E2E-002', start)

    await publishStrokes(line, start, minute(3))
    await scrap(api, line, jobOrder, 25, start, minute(3))
    await strokesIngested(line, start, minute(3), 30)

    expect(await oeeOf(api, line.press._id, start, minute(3))).toMatchObject({
      productivity: { percentage: 100, status: 'ok' },
      quality: { percentage: 75, status: 'ok' },
      oee: { percentage: 75, status: 'ok' },
    })
  })

  // A minute into a job order three of the four die holes blocked, so each stroke stamped 1 part,
  // but nobody recorded it until the run was over and every stroke counted as 4 parts. A
  // supervisor who may backdate standards dates the 1 part standard back to that minute, with the
  // reason, and OEE follows: 40 + 10 + 10 = 60 parts instead of 120, half of them scrapped.
  it('lets a supervisor correct a standard after the fact, with a reason', async () => {
    const { api } = await loginAsAdmin()
    const start = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 10 * 60_000)
    const minute = (n: number) => new Date(start.getTime() + n * 60_000)
    const line = await createPressLine(api, 'PRESS-03')
    await createStandard(api, line, new Date(start.getTime() - 3_600_000), 40, 4)
    const jobOrder = await startJobOrder(api, line, 'JO-E2E-004', start)
    await publishStrokes(line, start, minute(3))
    await scrap(api, line, jobOrder, 30, start, minute(3))
    await strokesIngested(line, start, minute(3), 30)
    expect(await oeeOf(api, line.press._id, start, minute(3))).toMatchObject({
      quality: { percentage: 75, status: 'ok' },
    })

    await expect(createStandard(api, line, minute(1), 10, 1)).rejects.toThrow('answered 400')
    await createStandard(api, line, minute(1), 10, 1, 'Three die holes blocked from minute 1')

    expect(await oeeOf(api, line.press._id, start, minute(3))).toMatchObject({
      productivity: { percentage: 100, status: 'ok' },
      quality: { percentage: 50, status: 'ok' },
      oee: { percentage: 50, status: 'ok' },
    })
  })

  // A loom's ideal speed is 400 picks a minute, at which it weaves 2 m² of carpet a minute. For
  // ten minutes it runs at 300 picks a minute (15 m²) and 3 m² are scrapped.
  it('speed based: reports 75% productivity and 80% quality at 300 of 400 picks', async () => {
    const { api } = await loginAsAdmin()
    const start = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 20 * 60_000)
    const end = new Date(start.getTime() + 10 * 60_000)

    const tagType = await api.post<Created>('telemetry', '/api/v1/tag-types', {
      name: 'Loom signals',
    })
    const speed = await api.post<Created>('telemetry', '/api/v1/tags', {
      name: 'Loom 01 speed',
      tagTypeId: tagType._id,
      behavior: 'speed',
      binding: { deviceKey: 'loom-01', nodeId: 'speed' },
    })
    const runMode = await api.post<Created>('telemetry', '/api/v1/tags', {
      name: 'Loom 01 run mode',
      tagTypeId: tagType._id,
      behavior: 'binary',
      binding: { deviceKey: 'loom-01', nodeId: 'run' },
    })

    const shift = await api.post<Created>('work-center', '/api/v1/shifts', {
      name: 'Loom day',
      startHour: 0,
      startMinute: 0,
      endHour: 23,
      endMinute: 59,
    })
    const loom = await api.post<Created>('work-center', '/api/v1/work-centers', {
      code: 'LOOM-01',
      name: 'Loom 01',
      type: 'physical',
      productivityMode: 'speed_based',
      tagBindings: { runModeTagId: runMode._id, speedTagId: speed._id },
      shiftIds: [shift._id],
    })

    const uom = await api.post<Created>('production', '/api/v1/uoms', {
      code: 'M2',
      name: 'Square metre',
      symbol: 'm2',
    })
    const product = await api.post<Created>('production', '/api/v1/products', {
      code: 'CARPET-01',
      name: 'Carpet',
      kind: 'finished',
      uomId: uom._id,
    })
    await api.post('production', '/api/v1/product-standards', {
      productId: product._id,
      workCenterId: loom._id,
      validFrom: new Date(start.getTime() - 3_600_000).toISOString(),
      idealOutputPerMinute: 2,
      idealSpeed: 400,
    })
    const jobOrder = await api.post<Created>('production', '/api/v1/job-orders', {
      code: 'JO-E2E-003',
      productId: product._id,
      workCenterId: loom._id,
      targetQuantity: 1000,
    })
    await api.post('production', `/api/v1/job-orders/${jobOrder._id}/start`, {
      startTime: start.toISOString(),
    })

    // The PLC reports a speed only when it changes; the loom holds 300 picks a minute.
    await publishSamples('loom-01', 'speed', [{ value: 300, time: start }])
    await api.post('production', '/api/v1/scrap-entries', {
      jobOrderId: jobOrder._id,
      shiftId: shift._id,
      amount: 3,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    })

    await eventually(
      () =>
        Api.internal().post<{ total: { valueArea: number } }>(
          'telemetry',
          `/internal/v1/historian/${speed._id}/speed-summary`,
          { windows: [{ from: start.toISOString(), to: end.toISOString() }] },
        ),
      summary => summary.total.valueArea === 300 * 10 * 60_000,
    )

    expect(await oeeOf(api, loom._id, start, end)).toMatchObject({
      availability: { percentage: 100, status: 'ok' },
      productivity: { percentage: 75, status: 'ok' },
      quality: { percentage: 80, status: 'ok' },
      oee: { percentage: 60, status: 'ok' },
    })
  })

  it('gives the creator access to every work center created at the same time', async () => {
    const { api } = await loginAsAdmin()
    const codes = ['CELL-01', 'CELL-02', 'CELL-03', 'CELL-04', 'CELL-05']

    const created = await Promise.all(
      codes.map(code =>
        api.post<Created>('work-center', '/api/v1/work-centers', {
          code,
          name: code,
          type: 'virtual',
        }),
      ),
    )
    const me = await api.get<{ workCenterIds: string[] }>('user', '/api/v1/users/me')

    expect(me.workCenterIds).toEqual(expect.arrayContaining(created.map(wc => wc._id)))
  })

  it('stops answering OEE for a work center as soon as access to it is revoked', async () => {
    const { api, userId } = await loginAsAdmin()
    const cell = await api.post<Created>('work-center', '/api/v1/work-centers', {
      code: 'CELL-REVOKED',
      name: 'Revoked cell',
      type: 'virtual',
    })
    const to = new Date()
    const from = new Date(to.getTime() - 3_600_000)
    await oeeOf(api, cell._id, from, to)

    const me = await api.get<{ workCenterIds: string[] }>('user', '/api/v1/users/me')
    await api.patch('user', `/api/v1/users/${userId}`, {
      workCenterIds: me.workCenterIds.filter(id => id !== cell._id),
    })

    await expect(oeeOf(api, cell._id, from, to)).rejects.toThrow('answered 404')
  })

  // A user who lost access to a work center must not read its records by asking for it by id.
  it('keeps lists within the work centers the user can see, whatever filter it sends', async () => {
    const { api, userId } = await loginAsAdmin()
    const line = await createPressLine(api, 'PRESS-05')
    await createStandard(api, line, new Date(Date.now() - 3_600_000), 40, 4)
    await api.post('production', '/api/v1/job-orders', {
      code: 'JO-E2E-HIDDEN',
      productId: line.product._id,
      workCenterId: line.press._id,
      targetQuantity: 10,
    })
    const me = await api.get<{ workCenterIds: string[] }>('user', '/api/v1/users/me')
    await api.patch('user', `/api/v1/users/${userId}`, {
      workCenterIds: me.workCenterIds.filter(id => id !== line.press._id),
    })

    const press = line.press._id
    expect(await api.get('production', `/api/v1/job-orders?workCenterId=${press}`)).toEqual([])
    expect(await api.get('production', `/api/v1/job-orders?workCenterIds=${press}`)).toEqual([])
    expect(await api.get('production', `/api/v1/product-standards?workCenterId=${press}`)).toEqual(
      [],
    )
  })

  it('answers 404 to reading, changing or referencing a work center the user can no longer see', async () => {
    const { api, userId } = await loginAsAdmin()
    const cell = await api.post<Created>('work-center', '/api/v1/work-centers', {
      code: 'CELL-LOCKED',
      name: 'Locked cell',
      type: 'virtual',
    })
    const me = await api.get<{ workCenterIds: string[] }>('user', '/api/v1/users/me')
    await api.patch('user', `/api/v1/users/${userId}`, {
      workCenterIds: me.workCenterIds.filter(id => id !== cell._id),
    })

    const path = `/api/v1/work-centers/${cell._id}`
    await expect(api.patch('work-center', path, { name: 'Taken over' })).rejects.toThrow(
      'answered 404',
    )
    await expect(api.request('work-center', 'DELETE', path)).rejects.toThrow('answered 404')
    await expect(
      api.get('performance', `/api/v1/performance-policies/work-centers/${cell._id}`),
    ).rejects.toThrow('answered 404')
    await expect(api.get('work-center', `${path}/operators`)).rejects.toThrow('answered 404')
    await expect(api.get('work-center', `${path}/calendars`)).rejects.toThrow('answered 404')
    const primary = { rule: 'primary_work_center', contributors: [{ workCenterId: cell._id }] }
    await expect(
      api.post('work-center', '/api/v1/work-centers', {
        code: 'BLOCK-PEEK',
        name: 'Peek block',
        type: 'virtual',
        metricComposition: { availability: primary, productivity: primary, quality: primary },
      }),
    ).rejects.toThrow('answered 404')
    const kept = await Api.internal().get<{ name: string }>(
      'work-center',
      `/internal/v1/work-centers/${cell._id}`,
    )
    expect(kept.name).toBe('Locked cell')
  })

  // People, barcode scanners and other systems match records by code, so a code has one spelling.
  it('stores codes in one spelling, so KG and kg cannot be two units', async () => {
    const { api } = await loginAsAdmin()
    const unit = { name: 'E2E kilogram', symbol: 'kg' }

    const created = await api.post<{ code: string }>('production', '/api/v1/uoms', {
      ...unit,
      code: ' kg-e2e ',
    })
    const cell = await api.post<{ code: string }>('work-center', '/api/v1/work-centers', {
      code: 'cell-lower',
      name: 'Lower case cell',
      type: 'virtual',
    })

    expect([created.code, cell.code]).toEqual(['KG-E2E', 'CELL-LOWER'])
    await expect(
      api.post('production', '/api/v1/uoms', { ...unit, name: 'E2E kilo', code: 'KG-E2E' }),
    ).rejects.toThrow('answered 409')
    await expect(
      api.post('production', '/api/v1/uoms', { ...unit, name: 'E2E chassis', code: 'ŞASİ' }),
    ).rejects.toThrow('answered 400')
  })

  // A service can fail in the background (a crashed stream consumer, a failed startup job)
  // while every request still succeeds. Its error log is the only trace.
  it('leaves no error in any service log', async () => {
    const logDir = inject('logDir')
    const errors: string[] = []
    for (const file of await readdir(logDir)) {
      const lines = (await readFile(join(logDir, file), 'utf8')).split('\n')
      errors.push(...lines.filter(line => line.includes('"level":"error"')))
    }

    expect(errors).toEqual([])
  })
})
