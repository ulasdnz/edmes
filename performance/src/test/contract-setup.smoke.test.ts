import { MONGO_IMAGE } from '@mes/testing'
import { MongoDBContainer } from '@testcontainers/mongodb'
import { Redis } from 'ioredis'
import mongoose from 'mongoose'
import { GenericContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('Testcontainers smoke gate', () => {
  let redisPort: number
  let mongoContainer: Awaited<ReturnType<MongoDBContainer['start']>>
  let redisContainer: Awaited<ReturnType<GenericContainer['start']>>
  let conn: mongoose.Connection

  beforeAll(async () => {
    mongoContainer = await new MongoDBContainer(MONGO_IMAGE).start()
    let uri = mongoContainer.getConnectionString()
    if (!uri.includes('directConnection=true')) {
      uri += uri.includes('?') ? '&directConnection=true' : '?directConnection=true'
    }
    uri = uri.replace('localhost', '127.0.0.1')
    conn = await mongoose.createConnection(uri).asPromise()

    redisContainer = await new GenericContainer('redis:7').withExposedPorts(6379).start()
    redisPort = redisContainer.getMappedPort(6379)
  }, 120_000)

  afterAll(async () => {
    await conn?.close()
    await mongoContainer?.stop()
    await redisContainer?.stop()
  })

  it('connects to MongoDB and runs a trivial operation', async () => {
    expect(conn.readyState).toBe(1)
    const db = conn.db!
    await db.collection('smoke').insertOne({ ok: true })
    const doc = await db.collection('smoke').findOne({ ok: true })
    expect(doc?.ok).toBe(true)
  })

  it('connects to Redis and runs a trivial operation', async () => {
    const redis = new Redis(`redis://127.0.0.1:${redisPort}`, {
      enableOfflineQueue: false,
      lazyConnect: true,
    })
    await redis.connect()
    await redis.set('smoke', 'ok')
    const val = await redis.get('smoke')
    expect(val).toBe('ok')
    await redis.quit()
  })
})
