import mqtt from 'mqtt'
import { inject } from 'vitest'

// Publishes tag values the way an edge device does: one MQTT message per sample.
export async function publishSamples(
  deviceKey: string,
  nodeId: string,
  samples: Array<{ value: number; time: Date }>,
) {
  const { url, username, password } = inject('mqtt')
  const client = await mqtt.connectAsync(url, { username, password })
  try {
    for (const { value, time } of samples) {
      await client.publishAsync(
        `devices/${deviceKey}/nodes/${nodeId}`,
        JSON.stringify({ value, time: time.toISOString() }),
        { qos: 1 },
      )
    }
  } finally {
    await client.endAsync()
  }
}
