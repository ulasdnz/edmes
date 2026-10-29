import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 120000,
    include: ['src/**/*.{test,spec}.ts'],
  },
})
