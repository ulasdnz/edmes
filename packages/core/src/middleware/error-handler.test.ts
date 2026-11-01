import type { NextFunction, Request, Response } from 'express'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'winston'
import { CustomError } from '../errors/index.js'
import type { ErrorResponse } from '../types/index.js'
import { createErrorHandler } from './error-handler.js'

async function respond(err: unknown, translation: Record<string, unknown>) {
  const i18n = i18next.createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation } } })
  const req = { t: i18n.t.bind(i18n), i18n, method: 'PUT', path: '/policies' } as unknown as Request
  let body: ErrorResponse | undefined
  const res = {
    status: () => res,
    json: (payload: ErrorResponse) => {
      body = payload
      return res
    },
  } as unknown as Response<ErrorResponse>
  const logger = { error: vi.fn() } as unknown as Logger

  createErrorHandler({ logger, nodeEnv: 'test' })(err, req, res, (() => {}) as NextFunction)
  return body
}

describe('createErrorHandler', () => {
  it('fills the placeholders of a message from the error details', async () => {
    const body = await respond(new CustomError(429, 'auth.locked', { remainingSeconds: 30 }), {
      auth: { locked: 'Try again in {{remainingSeconds}} seconds.' },
    })

    expect(body?.error.message).toBe('Try again in 30 seconds.')
  })

  // A package with its own copy of @mes/core throws errors this copy does not know as CustomError
  it('fills them for an error that only carries a status code', async () => {
    const err = Object.assign(new Error('auth.locked'), {
      statusCode: 429,
      details: { remainingSeconds: 30 },
    })

    const body = await respond(err, {
      auth: { locked: 'Try again in {{remainingSeconds}} seconds.' },
    })

    expect(body?.error.message).toBe('Try again in 30 seconds.')
  })

  it('keeps the characters of a value as they are in the JSON message', async () => {
    const body = await respond(new CustomError(400, 'error.codes', { codes: 'PRS/01, A&B' }), {
      error: { codes: 'Work centers: {{codes}}' },
    })

    expect(body?.error.message).toBe('Work centers: PRS/01, A&B')
  })
})
