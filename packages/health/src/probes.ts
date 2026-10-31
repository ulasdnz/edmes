import type { HealthProbe } from './types.js'

const DEFAULT_TIMEOUT_MS = 1500

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)

    promise
      .then(value => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(err => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

export function mongoProbe(
  mongoose: {
    connection: {
      readyState: number
      db?: { admin: () => { ping: () => Promise<unknown> } } | null
    }
  },
  timeoutMs = DEFAULT_TIMEOUT_MS,
): HealthProbe {
  return {
    name: 'mongodb',
    check: async () => {
      const mongoCheck =
        mongoose.connection.readyState === 1 && mongoose.connection.db
          ? mongoose.connection.db.admin().ping()
          : Promise.reject(new Error('MongoDB disconnected'))

      await withTimeout(mongoCheck, timeoutMs, 'MongoDB')
    },
  }
}

export function redisProbe(
  redisClient: { ping: () => Promise<string> },
  timeoutMs = DEFAULT_TIMEOUT_MS,
): HealthProbe {
  return {
    name: 'redis',
    check: async () => {
      await withTimeout(redisClient.ping(), timeoutMs, 'Redis')
    },
  }
}
