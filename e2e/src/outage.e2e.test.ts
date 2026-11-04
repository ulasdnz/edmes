import { setTimeout as sleep } from 'node:timers/promises'
import mqtt from 'mqtt'
import { describe, expect, inject, it } from 'vitest'
import { Api, eventually, loginAsAdmin } from './support/api.js'
import { publishSamples } from './support/plc.js'
import { startService, stopService } from './support/services.js'

type Created = { _id: string }
type Sample = { value: number; time: Date }

// A modelled plant: 20 machines with 10 tags each, every tag read once a second and published at
// QoS 1, 200 messages a second. Each machine reports whether it runs and 9 counters. The first
// machine stops and starts again every second; the others keep running.
const MACHINES = Array.from({ length: 20 }, (_, m) => `plant-m${String(m + 1).padStart(2, '0')}`)
const NODES = ['run', ...Array.from({ length: 9 }, (_, k) => `counter-${k + 1}`)]

function latestSample(tagId: string) {
  return Api.internal().get<{ value: number; occurredAt: string } | null>(
    'telemetry',
    `/internal/v1/historian/${tagId}/latest`,
  )
}

// Binds every tag of the plant in telemetry and returns the first machine's run-mode tag
async function createPlantTags(api: Api) {
  const tagType = await api.post<Created>('telemetry', '/api/v1/tag-types', {
    name: 'Plant signals',
  })
  const tags: Created[] = []
  for (const deviceKey of MACHINES) {
    const machineTags = await Promise.all(
      NODES.map(nodeId =>
        api.post<Created>('telemetry', '/api/v1/tags', {
          name: `${deviceKey} ${nodeId}`,
          tagTypeId: tagType._id,
          behavior: nodeId === 'run' ? 'binary' : 'counter',
          binding: { deviceKey, nodeId },
        }),
      ),
    )
    tags.push(...machineTags)
  }
  return tags[0]
}

// Publishes every tag of the plant once a second, stamped with the time the machines read it, until
// stopped. `runMode` holds the first machine's run-mode samples once the broker has taken them.
async function startPlant() {
  const { url, username, password } = inject('mqtt')
  const client = await mqtt.connectAsync(url, { username, password })
  const runMode: Sample[] = []
  let running = true
  const publishing = (async () => {
    const start = Date.now()
    for (let second = 0; running; second++) {
      await sleep(Math.max(0, start + second * 1000 - Date.now()))
      const time = new Date()
      await Promise.all(
        MACHINES.flatMap((deviceKey, machine) =>
          NODES.map(nodeId => {
            const value = nodeId !== 'run' ? second : machine === 0 ? second % 2 : 1
            return client.publishAsync(
              `devices/${deviceKey}/nodes/${nodeId}`,
              JSON.stringify({ value, time: time.toISOString() }),
              { qos: 1 },
            )
          }),
        ),
      )
      runMode.push({ value: second % 2, time })
    }
  })()

  return {
    runMode,
    // Resolves once the first machine has published this many run-mode samples in all
    async published(count: number) {
      while (runMode.length < count) await Promise.race([publishing, sleep(50)])
    },
    async stop() {
      running = false
      try {
        await publishing
      } finally {
        await client.endAsync()
      }
    },
  }
}

describe('a telemetry outage the MQTT broker bridges', () => {
  // The machine stops, telemetry goes down once performance has opened the stop, and the machine
  // runs again while telemetry is still down. Telemetry comes back as a new process, so the running
  // signal reaches it only if the broker kept the session it queued the signal for.
  it('closes a stop with the running signal that waited at the broker while telemetry was down', async () => {
    const { api } = await loginAsAdmin()
    const tagType = await api.post<Created>('telemetry', '/api/v1/tag-types', {
      name: 'Outage press signals',
    })
    const runMode = await api.post<Created>('telemetry', '/api/v1/tags', {
      name: 'Outage press run mode',
      tagTypeId: tagType._id,
      behavior: 'binary',
      binding: { deviceKey: 'outage-press', nodeId: 'run' },
    })
    const strokes = await api.post<Created>('telemetry', '/api/v1/tags', {
      name: 'Outage press strokes',
      tagTypeId: tagType._id,
      behavior: 'counter',
      binding: { deviceKey: 'outage-press', nodeId: 'strokes' },
    })
    const press = await api.post<Created>('work-center', '/api/v1/work-centers', {
      code: 'OUTAGE-PRESS',
      name: 'Outage press',
      type: 'physical',
      productivityMode: 'count_based',
      tagBindings: { runModeTagId: runMode._id, productionCounterTagId: strokes._id },
    })
    await api.request(
      'performance',
      'PUT',
      `/api/v1/performance-policies/work-centers/${press._id}`,
      { runModeDebounceMs: 60_000 },
    )

    const listStops = () =>
      api.get<Array<{ startAt: string; endAt: string | null }>>(
        'performance',
        `/api/v1/unplanned-stops?workCenterId=${press._id}`,
      )
    const t0 = new Date()
    await publishSamples('outage-press', 'run', [{ value: 0, time: t0 }])
    // The stop opens once the debounce runs out, which shows performance took the stopped sample.
    // Stored by telemetry is not enough: performance may learn of the new work center later, and
    // with telemetry down by then it would start from whatever sample is latest when it comes back
    await sleep(t0.getTime() + 60_000 - Date.now())
    await eventually(listStops, list =>
      list.some(stop => stop.startAt === t0.toISOString() && stop.endAt === null),
    )

    await stopService('telemetry')
    const t1 = new Date()
    try {
      await publishSamples('outage-press', 'run', [{ value: 1, time: t1 }])
    } finally {
      await startService('telemetry')
    }

    const stops = await eventually(listStops, list => list.some(stop => stop.endAt !== null))
    expect(stops.map(({ startAt, endAt }) => ({ startAt, endAt }))).toEqual([
      { startAt: t0.toISOString(), endAt: t1.toISOString() },
    ])
  }, 150_000)

  // 20 s at 200 messages a second is 4000 messages, four times the 1000 Mosquitto holds for a client
  // that is away unless told otherwise
  it('keeps every run-mode transition a plant publishes during an outage', async () => {
    const { api } = await loginAsAdmin()
    const runMode = await createPlantTags(api)
    const plant = await startPlant()
    try {
      await plant.published(2)
      await stopService('telemetry')
      const first = plant.runMode.length
      try {
        await plant.published(first + 20)
      } finally {
        await startService('telemetry')
      }
      const before = plant.runMode[first - 1]
      const outage = plant.runMode.slice(first, first + 20)
      const last = outage[outage.length - 1]

      // The broker delivers in order, so once telemetry has stored a sample from after the outage,
      // it has worked off the backlog
      await eventually(
        () => latestSample(runMode._id),
        latest => latest !== null && new Date(latest.occurredAt) > last.time,
      )
      const query = new URLSearchParams({
        from: before.time.toISOString(),
        to: last.time.toISOString(),
        limit: '100',
      })
      const stored = await api.get<Array<{ value: number; occurredAt: string }>>(
        'telemetry',
        `/api/v1/historian/${runMode._id}/samples?${query}`,
      )
      expect(stored.map(({ value, occurredAt }) => ({ value, occurredAt }))).toEqual(
        outage.map(({ value, time }) => ({ value, occurredAt: time.toISOString() })),
      )
    } finally {
      await plant.stop()
    }
  }, 120_000)
})
