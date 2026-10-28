import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/test/contracts/**/*.{test,spec}.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test_secret',
      INTERNAL_API_TOKEN: 'test-internal-api-token-at-least-32-chars',
      INTERNAL_API_USER: 'http://localhost:3000',
    },
  },
})
