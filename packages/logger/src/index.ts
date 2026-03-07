import morgan from 'morgan'
import type { Request, RequestHandler, Response } from 'express'
import winston from 'winston'
import { getContext } from '@mes/core'

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
    const { level, message, timestamp, traceId, stack } = info

    const logMessage = stack || message || 'No message provided'

    return `[${timestamp}] ${level} [traceId=${traceId || 'no-trace'}] ${logMessage}`
  }),
)

export const createLogger = ({ level, serviceName }: LoggerOptions) => {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: winston.format.combine(
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
