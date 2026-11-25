import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { dedupe: ['react', 'react-dom'] },
  // Bundled before the first test: a dependency found mid-run makes Vite reload the tests, which
  // then fail on a cold cache (CI).
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'vitest-browser-react',
      '@tanstack/react-query',
      '@tanstack/react-router',
      'i18next',
      'react-i18next',
      '@mes/ui > @base-ui/react/button',
      '@mes/ui > @base-ui/react/dialog',
      '@mes/ui > @base-ui/react/input',
      '@mes/ui > @base-ui/react/menu',
      '@mes/ui > @base-ui/react/popover',
      '@mes/ui > class-variance-authority',
      '@mes/ui > cn',
      '@mes/ui > lucide-react',
      '@mes/ui > sonner',
      '@mes/frontend > @date-fns/tz',
      '@mes/frontend > socket.io-client',
      '@mes/frontend > zod',
      '@mes/frontend > zustand/vanilla',
      '@mes/api-client > openapi-fetch',
      '@mes/api-client > openapi-react-query',
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.tsx'],
          setupFiles: ['./src/test/setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
