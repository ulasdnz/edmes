import type { Request, Response } from 'express'
import * as historianService from './historian.service.js'
import { parseInterval } from './historian.validators.js'

export const getCompactValues = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as { from: string; to: string }
  const data = await historianService.getCompactValues(
    req.params.tagId,
    new Date(from),
    new Date(to),
  )
  res.json({ data })
}

export const getSamples = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to, page, limit, previous } = req.query as Record<string, string>
  const result = await historianService.getSamples(
    req.params.tagId,
    new Date(from),
    new Date(to),
    Number(page) || 1,
    Number(limit) || 100,
    previous === 'true',
  )
  res.json({
    data: result.data,
    ...(result.previousDoc ? { previous: result.previousDoc } : {}),
    pagination: result.pagination,
  })
}

export const getSampleCount = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as { from: string; to: string }
  const count = await historianService.getSampleCount(
    req.params.tagId,
    new Date(from),
    new Date(to),
  )
  res.json({ data: { count } })
}

export const getStats = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as { from: string; to: string }
  const stats = await historianService.getStats(req.params.tagId, new Date(from), new Date(to))
  res.json({ data: stats })
}

export const getProduced = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as { from: string; to: string }
  const produced = await historianService.getProduced(
    req.params.tagId,
    new Date(from),
    new Date(to),
  )
  res.json({ data: { produced } })
}

export const getSpeedAvg = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as { from: string; to: string }
  const result = await historianService.getSpeedAvg(req.params.tagId, new Date(from), new Date(to))
  res.json({ data: result })
}

export const getStateDurations = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to } = req.query as { from: string; to: string }
  const segments = await historianService.getStateDurations(
    req.params.tagId,
    new Date(from),
    new Date(to),
  )
  res.json({ data: segments })
}

export const getRollup = async (req: Request<{ tagId: string }>, res: Response) => {
  const { from, to, interval, fn } = req.query as {
    from: string
    to: string
    interval: string
    fn: 'avg' | 'min' | 'max' | 'sum' | 'count'
  }
  const intervalMs = parseInterval(interval)
  const buckets = await historianService.getRollup(
    req.params.tagId,
    new Date(from),
    new Date(to),
    intervalMs,
    fn,
  )
  res.json({ data: buckets })
}
