/**
 * Type augmentation for Express Request with i18next.
 *
 * i18next-http-middleware augments `req` with `t()` and `i18n`.
 * Since @mes/core's error-handler uses these, we declare them here
 * so the package compiles without requiring i18next-http-middleware
 * as a direct dependency.
 */

import type { i18n, TFunction } from 'i18next'

declare global {
  namespace Express {
    interface Request {
      t: TFunction
      i18n: i18n
      language: string
      languages: string[]
    }
  }
}

export {}
