import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import type { TestProject } from 'vitest/node'
import { MONGO_ENVIRONMENT, MONGO_IMAGE } from './images.js'
import './provided-context.js'

let container: StartedMongoDBContainer | undefined

// Vitest global setup: one MongoDB for a package's whole test run, and each test file takes a
// database of its own on it (setupMongoDatabase), so the files still run in parallel without sharing
// data. A container per file meant about 65 containers a run, and every test process first found
// Testcontainers' reaper under one lock they all share; under that load some files waited past the
// hook timeout before their container even existed.
export async function setup(project: TestProject): Promise<void> {
  container = await new MongoDBContainer(MONGO_IMAGE).withEnvironment(MONGO_ENVIRONMENT).start()
  let uri = container.getConnectionString()
  if (!uri.includes('directConnection=true')) {
    uri += uri.includes('?') ? '&directConnection=true' : '?directConnection=true'
  }
  project.provide('mongoUri', uri.replace('localhost', '127.0.0.1'))
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
