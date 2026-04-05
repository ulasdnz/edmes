import type { Request, Response } from 'express'
import { getDiscoveryManifestByDevice, getDiscoveryManifests } from './discovery.service.js'
import type { DiscoveryQuery } from './discovery.validators.js'

export const getAllManifests = async (_req: Request<unknown, unknown, unknown, DiscoveryQuery>, res: Response) => {
  const data = await getDiscoveryManifests(_req.query.availableOnly === 'true')
  res.json({ data })
}

export const getManifestByDevice = async (
  req: Request<{ deviceKey: string }, unknown, unknown, DiscoveryQuery>,
  res: Response,
) => {
  const data = await getDiscoveryManifestByDevice(
    req.params.deviceKey,
    req.query.availableOnly === 'true',
  )
  res.json({ data })
}
