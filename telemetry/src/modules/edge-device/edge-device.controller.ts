import type { Request, Response } from 'express'
import type { SuccessResponse } from '../../core/types/index.js'
import type { IEdgeDevice } from './edge-device.model.js'
import * as edgeDeviceService from './edge-device.service.js'

export const createEdgeDevice = async (
  req: Request,
  res: Response<SuccessResponse<IEdgeDevice>>,
) => {
  const edgeDevice = await edgeDeviceService.createEdgeDevice(req.body)

  res.status(201).json({
    data: edgeDevice,
    message: req.t('success.create'),
  })
}

export const getEdgeDevices = async (
  _req: Request,
  res: Response<SuccessResponse<IEdgeDevice[]>>,
) => {
  const edgeDevices = await edgeDeviceService.getEdgeDevices()

  res.json({
    data: edgeDevices,
  })
}

export const getEdgeDeviceById = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IEdgeDevice>>,
) => {
  const edgeDevice = await edgeDeviceService.getEdgeDeviceById(req.params.id)

  res.json({
    data: edgeDevice,
  })
}

export const updateEdgeDevice = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse<IEdgeDevice>>,
) => {
  const edgeDevice = await edgeDeviceService.updateEdgeDevice(req.params.id, req.body)

  res.json({
    data: edgeDevice,
    message: req.t('success.update'),
  })
}

export const deleteEdgeDevice = async (
  req: Request<{ id: string }>,
  res: Response<SuccessResponse>,
) => {
  await edgeDeviceService.deleteEdgeDevice(req.params.id)

  res.json({
    data: undefined,
    message: req.t('success.delete'),
  })
}
