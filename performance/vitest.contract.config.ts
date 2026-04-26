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
    // Run contract files sequentially. Files share the testcontainer Mongo/Redis,
    // and contract-setup.ts wipes collections in afterEach; parallel files can
    // race with that cleanup. Keep Vitest isolation enabled so each file owns
    // its Mongo/Redis connections and teardown.
    maxWorkers: 1,
  },
})
