import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.e2e.test.ts'],
    globalSetup: ['src/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    // Teardown lets the services shut down gracefully (up to 8s each) before the containers stop
    teardownTimeout: 30_000,
    fileParallelism: false,
  },
})
