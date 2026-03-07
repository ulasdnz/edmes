import type { NextFunction, Request, Response } from 'express'
import type { ZodType } from 'zod'

export const validateBody =
  (schema: ZodType) => async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const result = await schema.parseAsync(req.body)
      req.body = result
      next()
    } catch (error) {
      next(error)
    }
  }

export const validateParams =
  (schema: ZodType) => async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const result = await schema.parseAsync(req.params)
      req.params = result as unknown as Request['params']
      next()
    } catch (error) {
      next(error)
    }
  }

export const validateQuery =
  (schema: ZodType) => async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const result = await schema.parseAsync(req.query)
      req.query = result as unknown as Request['query']
      next()
    } catch (error) {
      next(error)
    }
  }
