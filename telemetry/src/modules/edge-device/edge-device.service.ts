import CustomError from '../../core/errors/index.js'
import {
  emitEdgeDeviceCreated,
  emitEdgeDeviceDeleted,
  emitEdgeDeviceUpdated,
} from '../../jobs/events.js'
import EdgeDevice from './edge-device.model.js'
import type { CreateEdgeDeviceInput, UpdateEdgeDeviceInput } from './edge-device.validators.js'

export const createEdgeDevice = async (data: CreateEdgeDeviceInput) => {
  const existingName = await EdgeDevice.findOne({ name: data.name })
  if (existingName) {
    throw new CustomError(409, 'edge_device.name_in_use')
  }

  const existingKey = await EdgeDevice.findOne({ deviceKey: data.deviceKey })
  if (existingKey) {
    throw new CustomError(409, 'edge_device.device_key_in_use')
  }

  const edgeDevice = await EdgeDevice.create(data)
  await emitEdgeDeviceCreated(edgeDevice._id.toString())
  return edgeDevice
}

export const getEdgeDevices = async () => EdgeDevice.find().select('-__v').lean()

export const getEdgeDeviceById = async (id: string) => {
  const edgeDevice = await EdgeDevice.findById(id).select('-__v').lean()
  if (!edgeDevice) {
    throw new CustomError(404, 'edge_device.not_found')
  }
  return edgeDevice
}

export const updateEdgeDevice = async (id: string, data: UpdateEdgeDeviceInput) => {
  if (data.name) {
    const existing = await EdgeDevice.findOne({ name: data.name, _id: { $ne: id } })
    if (existing) {
      throw new CustomError(409, 'edge_device.name_in_use')
    }
  }

  const edgeDevice = await EdgeDevice.findByIdAndUpdate(
    id,
    { $set: data },
    { returnDocument: 'after', runValidators: true },
  )
  if (!edgeDevice) {
    throw new CustomError(404, 'edge_device.not_found')
  }

  await emitEdgeDeviceUpdated(edgeDevice._id.toString())
  return edgeDevice
}

export const deleteEdgeDevice = async (id: string) => {
  const edgeDevice = await EdgeDevice.findByIdAndDelete(id)
  if (!edgeDevice) {
    throw new CustomError(404, 'edge_device.not_found')
  }
  await emitEdgeDeviceDeleted(id)
}
