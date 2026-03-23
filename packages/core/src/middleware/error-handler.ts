import type { NextFunction, Request, Response } from 'express'
import type { Logger } from 'winston'
import { ZodError } from 'zod'
import { CustomError } from '../errors/index.js'
import type { ErrorDetail, ErrorResponse, MongoError } from '../types/index.js'

interface StatusCodeError extends Error {
  statusCode: number
  details?: Record<string, unknown>
}

const isStatusCodeError = (err: unknown): err is StatusCodeError => {
  if (!err || typeof err !== 'object') return false
  if (!('statusCode' in err)) return false
  const { statusCode } = err as { statusCode?: unknown }
  return typeof statusCode === 'number' && Number.isInteger(statusCode)
}

const normalizeStatusCode = (statusCode: number): number =>
  statusCode >= 400 && statusCode <= 599 ? statusCode : 500

const extractPasswordViolations = (
  details?: Record<string, unknown>,
): ErrorDetail[] | undefined => {
  const violations = details?.violations
  if (!Array.isArray(violations)) return undefined
  return (violations as string[]).map(v => ({
    field: 'password',
    message: v,
  }))
}

export interface ErrorHandlerOptions {
  logger: Logger
  nodeEnv: string
}

export const createErrorHandler =
  ({ logger, nodeEnv }: ErrorHandlerOptions) =>
  (err: unknown, req: Request, res: Response<ErrorResponse>, _next: NextFunction): void => {
    let isOperational = false
    let statusCode = 500

    let messageKey = 'error.unexpected'
    let messageParams: Record<string, string> = {}

    let details: ErrorDetail[] | undefined
    let stack: string | undefined

    const identity = ((key: string) => key) as typeof req.t
    const tLog = req.i18n?.getFixedT('en') ?? identity

    if (err instanceof ZodError) {
      isOperational = true
      statusCode = 400
      messageKey = 'error.validation_failed'
      details = err.issues.flatMap(e => {
        if (e.code === 'unrecognized_keys') {
          return e.keys.map(key => ({
            field: key,
            message: 'Field is not allowed.',
          }))
        }

        return {
          field: e.path.join('.'),
          message: e.message,
        }
      })
    } else if (err instanceof CustomError) {
      isOperational = true
      statusCode = normalizeStatusCode(err.statusCode)
      messageKey = err.message
      details = extractPasswordViolations(err.details)
    } else if (isStatusCodeError(err)) {
      isOperational = true
      statusCode = normalizeStatusCode(err.statusCode)
      messageKey = err.message || messageKey
      const extractedDetails = extractPasswordViolations(err.details)
      if (extractedDetails) {
        details = extractedDetails
      }
    } else if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
      isOperational = true
      statusCode = 409
      const mongoErr = err as MongoError
      const field = mongoErr.keyValue ? Object.keys(mongoErr.keyValue)[0] : 'field'
      messageKey = 'error.duplicate_entry'
      messageParams = { field }
    } else if (err instanceof Error) {
      stack = err.stack
      if (nodeEnv === 'development') {
        messageKey = err.message || messageKey
      }
    }

    const logPayload = {
      statusCode,
      method: req.method,
      path: req.route ? `${req.baseUrl}${req.route.path}` : req.path,
    }

    let logMessage = tLog(messageKey, messageParams) as string

    if (details) {
      const mappedDetails = details
        .map(e => `${e.field}: ${tLog(e.message, {}) as string}`)
        .join(', ')
      logMessage = `${logMessage} [${mappedDetails}]`
    }

    if (!isOperational) {
      logger.error(logMessage, { event: 'error.unexpected', ...logPayload, stack })
    }

    const t = req.t ?? identity
    const responseMessage = t(messageKey, messageParams) as string

    const responseDetails = details?.map(e => ({
      field: e.field,
      message: t(e.message, {}) as string,
    }))

    const response: ErrorResponse = {
      error: {
        code: messageKey,
        message: responseMessage,
        details: responseDetails,
      },
    }

    if (nodeEnv === 'development' && stack) {
      response.error.stack = stack
    }

    res.status(statusCode).json(response)
  }
