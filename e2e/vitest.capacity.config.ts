import { defineConfig } from 'vitest/config'

// The broker capacity measurement on the e2e harness. It takes over half an hour, so CI does not
// run it; docs/operations/mqtt-broker-capacity.md says how to.
export default defineConfig({
  test: {
    include: ['src/capacity/**/*.capacity.test.ts'],
    globalSetup: ['src/global-setup.ts'],
    provide: { brokerQueueCeiling: false },
    hookTimeout: 300_000,
    // Teardown lets the services shut down gracefully (up to 8s each) before the containers stop
    teardownTimeout: 30_000,
  },
})
