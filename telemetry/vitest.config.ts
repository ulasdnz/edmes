import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 120000,
    globalSetup: ['@mes/testing/mongo-server'],
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
      INTERNAL_API_TOKEN: 'test-internal-api-token-at-least-32-chars',
      REDIS_URL: 'redis://localhost:6379',
      INTERNAL_API_USER: 'http://localhost:3000',
      MQTT_URL: 'mqtt://localhost:1883',
      MQTT_USERNAME: 'test',
      MQTT_PASSWORD: 'test',
    },
  },
})
