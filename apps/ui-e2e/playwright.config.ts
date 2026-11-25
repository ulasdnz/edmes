import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// The system admin's credentials come from the stack's own .env; variables already set win.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
} catch {
  // no .env: the environment must provide them
}

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost'

export default defineConfig({
  testDir: './src',
  // The specs share one stack, and the outage spec stops a service of it
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalTeardown: './src/global-teardown.ts',
  use: {
    baseURL,
    trace: 'on',
  },
  projects: [
    {
      name: 'web',
      testMatch: /(routing|web-auth|web-users-realtime|outage)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'operator',
      testMatch: /operator-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, hasTouch: true },
    },
  ],
})
