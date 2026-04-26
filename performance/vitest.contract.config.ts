import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    globalSetup: ['src/test/contract-global-setup.ts'],
    setupFiles: ['src/test/contract-env-setup.ts'],
    include: ['src/**/__contract__/*.contract.test.ts'],
    pool: 'forks',
    // Run all contract files sequentially in a single fork. Files share the
    // testcontainer Mongo/Redis, and contract-setup.ts wipes collections in
    // afterEach — without single-fork serialization that wipe races with
    // other files' tests. Top-level `singleThread` only applies to pool='threads'.
    poolOptions: { forks: { singleFork: true } },
  },
})
