import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Some files import their modules in beforeAll, and a cold import on a busy machine has taken
    // longer than the default 10 s
    hookTimeout: 60000,
    env: {
      JWT_SECRET: 'test_secret',
      INTERNAL_API_TOKEN: 'test-internal-api-token-at-least-32-chars',
      INTERNAL_API_USER: 'http://localhost:3000',
    },
  },
})
