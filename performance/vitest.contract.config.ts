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
    singleThread: true,
  },
})
