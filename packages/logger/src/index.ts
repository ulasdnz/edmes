import { getContext } from '@mes/core'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import morgan from 'morgan'
import winston from 'winston'

export interface LoggerOptions {
  level: string
  serviceName: string
}

const contextFormat = winston.format(info => {
  const ctx = getContext()
  if (ctx) {
    info.traceId = ctx.traceId
    info.ip = ctx.ip
  }
  return info
})

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: () => new Date().toISOString() }),
  winston.format.printf(info => {
    const splat = info[Symbol.for('splat')] as unknown[] | undefined
    const splatMeta = Object.assign(
      {},
      ...(splat ?? []).filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      ),
    )

    const { level, message, timestamp, traceId, event, stack, service, ...rest } = {
      ...info,
      ...splatMeta,
    }

    const logMessage = stack || message || 'No message provided'
    const eventTag = event ? ` [${event}]` : ''
    const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''

    return `[${timestamp}] ${level} [traceId=${traceId || 'no-trace'}]${eventTag} ${logMessage}${meta}`
  }),
)

const jsonFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  contextFormat(),
  winston.format.timestamp(),
  winston.format.json(),
)

export const createLogger = ({ level, serviceName }: LoggerOptions) => {
  const isProd = process.env.NODE_ENV === 'production'

  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: isProd
        ? jsonFormat
        : winston.format.combine(
            winston.format.errors({ stack: true }),
            contextFormat(),
            consoleFormat,
          ),
    }),
  ]

  return winston.createLogger({
    level,
    defaultMeta: { service: serviceName },
    transports,
  })
}

export const createMorganMiddleware = (logger: winston.Logger): RequestHandler =>
  morgan(
    (tokens: morgan.TokenIndexer<Request, Response>, req: Request, res: Response) =>
      `${tokens.method(req, res)} ${tokens.url(req, res)} ${tokens.status(
        req,
        res,
      )} - ${tokens['response-time'](req, res)} ms`,
    {
      stream: {
        write: (message: string) => logger.http(message.trim()),
      },
    },
  )

export const createHttpLoggerMiddleware =
  (logger: winston.Logger): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint()

    let logged = false
    const log = (aborted: boolean) => {
      if (logged) return
      logged = true

      const duration = Math.round(Number(process.hrtime.bigint() - start) / 1e6)
      const path = req.route ? `${req.baseUrl}${req.route.path}` : req.path

      logger.http('HTTP request completed', {
        event: 'http.request.completed',
        method: req.method,
        path,
        statusCode: res.statusCode,
        duration,
        ...(aborted && { aborted: true }),
      })
    }

    res.on('finish', () => log(false))
    res.on('close', () => {
      if (!res.writableFinished) log(true)
    })

    next()
  }
