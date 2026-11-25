import { join } from 'node:path'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import type { Plugin, UserConfig } from 'vite'

const version = process.env.EDMES_VERSION ?? 'dev'
const backend = 'http://localhost'

function versionFile(): Plugin {
  return {
    name: 'edmes-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version })}\n`,
      })
    },
  }
}

export function sharedConfig(options: {
  root: string
  base: '/' | '/operator/'
  port: number
}): UserConfig {
  return {
    root: options.root,
    base: options.base,
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: join(options.root, 'src/routes'),
        generatedRouteTree: join(options.root, 'src/routeTree.gen.ts'),
      }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
      versionFile(),
    ],
    define: { __APP_VERSION__: JSON.stringify(version) },
    resolve: { dedupe: ['react', 'react-dom'] },
    server: {
      port: options.port,
      strictPort: true,
      proxy: {
        '/api': backend,
        '/uploads': backend,
        '/socket.io': { target: backend, ws: true },
      },
    },
  }
}
