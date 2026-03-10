import type { Express } from 'express'
import supertest from 'supertest'

export function createTestAgent(app: Express) {
  return supertest(app)
}

export type TestAgent = ReturnType<typeof createTestAgent>
