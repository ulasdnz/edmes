import type { Request, Response } from 'express'
import { CustomError } from '../../core/errors/index.js'
import type { SuccessResponse } from '../../core/types/index.js'
import { logger } from '../../lib/logger.js'
import EdgeDevice from '../edge-device/edge-device.model.js'
import { ingestValue } from '../ingestion/ingestion.pipeline.js'
import Tag from './tag.model.js'
import type { WriteCommandInput, WriteValueInput } from './tag-value.validators.js'

export const writeValue = async (
  req: Request<{ id: string }, unknown, WriteValueInput>,
  res: Response<SuccessResponse>,
) => {
  const tag = await Tag.findById(req.params.id)
  if (!tag) throw new CustomError(404, 'tag.not_found')

  await ingestValue(tag, req.body.value, req.body.time)

  res.status(201).json({ data: undefined, message: req.t('success.create') })
}

export const writeCommand = async (
  req: Request<{ id: string }, unknown, WriteCommandInput>,
  res: Response<SuccessResponse>,
) => {
  const tag = await Tag.findById(req.params.id)
  if (!tag) throw new CustomError(404, 'tag.not_found')
  if (!tag.writable) throw new CustomError(403, 'tag.not_writable')
  if (!tag.binding) throw new CustomError(400, 'tag.no_binding')

  const device = await EdgeDevice.findOne({ deviceKey: tag.binding.deviceKey }).lean()
  if (!device) throw new CustomError(404, 'edge_device.not_found')

  const url = `http://${device.ipAddress}:1880/api/nodes/${tag.binding.nodeId}/write`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: req.body.value }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    logger.warn('Node-RED write failed', {
      event: 'tag.command.failed',
      tagId: req.params.id,
      status: response.status,
    })
    throw new CustomError(502, 'tag.command_failed')
  }

  res.json({ data: undefined, message: req.t('success.update') })
}
