import { defineConfig } from 'vitest/config'

// The broker capacity measurement on the e2e harness. It takes over half an hour, so CI does not
// run it; docs/operations/mqtt-broker-capacity.md says how to.
// Telemetry and performance run as containers built from their Dockerfiles, under their compose
// limits. The broker runs the repository config under its compose limits, or, with
// CAPACITY_BROKER=uncapped, without the queue ceiling and limits, to measure what a queue needs.
const uncapped = process.env.CAPACITY_BROKER === 'uncapped'

export default defineConfig({
  test: {
    include: ['src/capacity/**/*.capacity.test.ts'],
    globalSetup: ['src/global-setup.ts'],
    provide: {
      brokerQueueCeiling: !uncapped,
      brokerLimits: !uncapped,
      containerServices: ['telemetry', 'performance'],
    },
    // Building the service images can take minutes without Docker's cache
    hookTimeout: 1_200_000,
    // Teardown lets the services shut down gracefully (up to 10s each) before the containers stop
    teardownTimeout: 60_000,
  },
})
