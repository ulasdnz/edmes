import mongoose from 'mongoose'
import { redisClient } from '../../lib/redis.js'
import type { HealthResponse } from './health.types.js'

const CHECK_TIMEOUT_MS = 1500

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

export async function checkMongoDB(): Promise<void> {
  const mongoCheck =
    mongoose.connection.readyState === 1 && mongoose.connection.db
      ? mongoose.connection.db.admin().ping()
      : Promise.reject(new Error('Mongo disconnected'))

  await withTimeout(mongoCheck, CHECK_TIMEOUT_MS, 'MongoDB')
}

export async function checkRedis(): Promise<void> {
  await withTimeout(redisClient.ping(), CHECK_TIMEOUT_MS, 'Redis')
}

export function buildHealthResponse(statusOverride?: 'healthy' | 'unhealthy'): HealthResponse {
  const mem = process.memoryUsage()

  return {
    status: statusOverride ?? 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
    services: {
      mongodb: 'healthy',
      redis: 'healthy',
    },
  }
}
