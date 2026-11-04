import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 120000,
    globalSetup: ['@mes/testing/mongo-server'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['src/test/contracts/**', 'src/**/__contract__/**'],
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://localhost:27017/test',
      JWT_SECRET: 'test_secret',
      INTERNAL_API_TOKEN: 'test-internal-api-token-at-least-32-chars',
      REDIS_URL: 'redis://localhost:6379',
      INTERNAL_API_USER: 'http://localhost:3000',
      INTERNAL_API_WORK_CENTER: 'http://localhost:3001',
      INTERNAL_API_PRODUCTION: 'http://localhost:3002',
      INTERNAL_API_TELEMETRY: 'http://localhost:3001',
    },
  },
})
