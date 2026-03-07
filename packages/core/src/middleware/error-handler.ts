import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import type { Logger } from 'winston'
import { CustomError } from '../errors/index.js'
import type { ErrorResponse, MongoError } from '../types/index.js'

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

    let errors: ErrorResponse['errors']
    let stack: string | undefined

    const tLog = req.i18n.getFixedT('en')

    if (err instanceof ZodError) {
      isOperational = true
      statusCode = 400
      messageKey = 'error.validation_failed'
      errors = err.issues.flatMap(e => {
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
      statusCode = err.statusCode
      messageKey = err.message
      if (err.details?.violations) {
        errors = (err.details.violations as string[]).map(v => ({
          field: 'password',
          message: v,
        }))
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
      path: req.path,
    }

    let logMessage = tLog(messageKey, messageParams) as string

    if (errors) {
      const mappedErrors = errors
        .map(e => `${e.field}: ${tLog(e.message, {}) as string}`)
        .join(', ')
      logMessage = `${logMessage} [${mappedErrors}]`
    }

    if (!isOperational) {
      logger.error(logMessage, { ...logPayload, stack })
    } else {
      logger.warn(logMessage, logPayload)
    }

    const responseMessage = req.t(messageKey, messageParams) as string

    const responseErrors = errors?.map(e => ({
      field: e.field,
      message: req.t(e.message, {}) as string,
    }))

    const response: ErrorResponse = {
      success: false,
      message: responseMessage,
      errors: responseErrors,
    }

    if (nodeEnv === 'development' && stack) {
      response.stack = stack
    }

    res.status(statusCode).json(response)
  }
