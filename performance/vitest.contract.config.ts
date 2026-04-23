import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 180000,
    include: ['src/**/__contract__/*.contract.test.ts'],
  },
})
