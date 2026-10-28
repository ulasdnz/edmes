import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    env: {
      JWT_SECRET: 'test_secret',
      INTERNAL_API_TOKEN: 'test-internal-api-token-at-least-32-chars',
      INTERNAL_API_USER: 'http://localhost:3000',
    },
  },
})
