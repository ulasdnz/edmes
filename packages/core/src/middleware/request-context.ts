import { AsyncLocalStorage } from 'async_hooks'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'

export interface RequestContext {
  traceId: string
  ip: string
  userId?: string
}

const als = new AsyncLocalStorage<RequestContext>()

export const contextMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const traceId = req.header('x-trace-id') ?? uuidv4()
  const ip = req.ip || '0.0.0.0'

  res.setHeader('X-Trace-Id', traceId)

  const store: RequestContext = {
    traceId,
    ip,
  }

  als.run(store, () => {
    next()
  })
}

export const getContext = (): RequestContext | undefined => {
  return als.getStore()
}

export const getTraceId = (): string => {
  const store = als.getStore()
  return store?.traceId || 'no-trace'
}

/**
 * Sets the userId in the current request's AsyncLocalStorage context.
 * Called by authenticate middleware and internal bypass middleware.
 * Audit-log plugin reads this via getContext().
 */
export const setUserId = (userId: string): void => {
  const store = als.getStore()
  if (store) store.userId = userId
}

export { als }
