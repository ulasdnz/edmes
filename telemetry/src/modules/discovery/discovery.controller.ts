import type { Request, Response } from 'express'
import { discoveryGetAll, discoveryGetByDevice } from './discovery.cache.js'

export const getAllManifests = async (_req: Request, res: Response) => {
  const data = discoveryGetAll()
  res.json({ data })
}

export const getManifestByDevice = async (req: Request<{ deviceKey: string }>, res: Response) => {
  const data = discoveryGetByDevice(req.params.deviceKey)
  res.json({ data })
}
