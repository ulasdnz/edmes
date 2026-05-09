import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/test/contracts/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://localhost:27017/test',
      JWT_SECRET: 'test_secret',
      REDIS_URL: 'redis://localhost:6379',
      INTERNAL_API_USER: 'http://localhost:3000',
      PLANT_TIMEZONE: 'Europe/Istanbul',
    },
  },
})
