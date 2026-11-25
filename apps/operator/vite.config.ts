import { defineConfig } from 'vite'
import { sharedConfig } from '../vite.shared.ts'

export default defineConfig(
  sharedConfig({ root: import.meta.dirname, base: '/operator/', port: 5174 }),
)
