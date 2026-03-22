import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['src/test/contracts/**'],
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://localhost:27017/test',
      JWT_SECRET: 'test_secret',
      REDIS_URL: 'redis://localhost:6379',
      INTERNAL_API_USER: 'http://localhost:3000',
    },
  },
})
