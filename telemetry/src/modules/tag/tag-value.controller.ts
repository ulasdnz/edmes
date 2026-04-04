import type { Request, Response } from 'express'
import { CustomError } from '../../core/errors/index.js'
import type { SuccessResponse } from '../../core/types/index.js'
import { logger } from '../../lib/logger.js'
import EdgeDevice from '../edge-device/edge-device.model.js'
import { ingestValue, type IngestValueResult } from '../ingestion/ingestion.pipeline.js'
import { predecessorLoad } from '../ingestion/predecessor-cache.js'
import Tag from './tag.model.js'
import type { WriteCommandInput, WriteValueInput } from './tag-value.validators.js'

interface WriteValueResponseData {
  inserted: boolean
  reason: IngestValueResult['reason']
}

export const writeValue = async (
  req: Request<{ id: string }, unknown, WriteValueInput>,
  res: Response<SuccessResponse<WriteValueResponseData>>,
) => {
  const tag = await Tag.findById(req.params.id)
  if (!tag) throw new CustomError(404, 'tag.not_found')

  let incomingValue = req.body.value
  if (tag.behavior !== 'binary' && tag.digit != null) {
    const factor = 10 ** tag.digit
    incomingValue = Math.round(incomingValue * factor) / factor
  }

  const pred = await predecessorLoad(tag._id.toString(), tag.behavior)
  if (pred && pred.value === incomingValue) {
    throw new CustomError(409, 'tag.same_value')
  }

  const result = await ingestValue(tag, req.body.value, req.body.time)

  if (!result.applied) {
    const errorCode =
      result.reason === 'out_of_order'
        ? 'tag.out_of_order'
        : result.reason === 'within_tolerance'
          ? 'tag.within_tolerance'
          : 'tag.same_value'
    throw new CustomError(409, errorCode)
  }

  res.status(201).json({
    data: { inserted: true, reason: result.reason },
    message: req.t('success.create'),
  })
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
    let downstreamPayload: unknown = null
    try {
      downstreamPayload = await response.json()
    } catch {
      downstreamPayload = null
    }

    const downstreamError =
      downstreamPayload &&
      typeof downstreamPayload === 'object' &&
      'error' in downstreamPayload &&
      typeof downstreamPayload.error === 'string'
        ? downstreamPayload.error
        : null

    logger.warn('Node-RED write failed', {
      event: 'tag.command.failed',
      tagId: req.params.id,
      status: response.status,
      nodeId: tag.binding.nodeId,
      deviceKey: tag.binding.deviceKey,
      downstreamError,
    })

    if (response.status >= 400 && response.status < 500) {
      const errorCode =
        downstreamError === 'unsupported_node' ? 'tag.command_unsupported' : 'tag.command_invalid'
      throw new CustomError(400, errorCode, { status: response.status, downstreamError })
    }

    throw new CustomError(502, 'tag.command_failed', { status: response.status, downstreamError })
  }

  res.json({ data: undefined, message: req.t('success.update') })
}
