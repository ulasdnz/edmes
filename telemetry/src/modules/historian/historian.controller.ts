import type { Request, Response } from 'express'
import * as historianService from './historian.service.js'
import { parseInterval } from './historian.validators.js'

export const getCompactValues = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as unknown as { from: Date; to: Date }
  const data = await historianService.getCompactValues(req.params.tagId, from, to)
  res.json({ data })
}

export const getSeries = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to, targetPoints } = req.query as unknown as {
    from: Date
    to: Date
    targetPoints: number
  }
  const result = await historianService.getSeries(req.params.tagId, from, to, targetPoints)
  res.json({ data: result.points, meta: result.meta })
}

export const getSamples = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to, page, limit, previous } = req.query as unknown as {
    from: Date
    to: Date
    page: number
    limit: number
    previous: 'true' | 'false'
  }
  const result = await historianService.getSamples(
    req.params.tagId,
    from,
    to,
    page || 1,
    limit || 100,
    previous === 'true',
  )
  res.json({
    data: result.data,
    ...(result.previousDoc ? { previous: result.previousDoc } : {}),
    pagination: result.pagination,
  })
}

export const getSampleCount = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as unknown as { from: Date; to: Date }
  const count = await historianService.getSampleCount(req.params.tagId, from, to)
  res.json({ data: { count } })
}

export const getStats = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as unknown as { from: Date; to: Date }
  const stats = await historianService.getStats(req.params.tagId, from, to)
  res.json({ data: stats })
}

export const getProduced = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as unknown as { from: Date; to: Date }
  const produced = await historianService.getProduced(req.params.tagId, from, to)
  res.json({ data: { produced } })
}

export const getSpeedAvg = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as unknown as { from: Date; to: Date }
  const result = await historianService.getSpeedAvg(req.params.tagId, from, to)
  res.json({ data: result })
}

export const getStateDurations = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as unknown as { from: Date; to: Date }
  const segments = await historianService.getStateDurations(req.params.tagId, from, to)
  res.json({ data: segments })
}

export const getRollup = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to, interval, fn } = req.query as unknown as {
    from: Date
    to: Date
    interval: string
    fn: 'avg' | 'min' | 'max' | 'sum' | 'count'
  }
  const intervalMs = parseInterval(interval)
  const buckets = await historianService.getRollup(req.params.tagId, from, to, intervalMs, fn)
  res.json({ data: buckets })
}
