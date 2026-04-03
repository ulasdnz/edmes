interface NodeInfo {
  nodeId: string
  name: string
  dataType?: string
}

interface DeviceManifest {
  deviceKey: string
  nodes: NodeInfo[]
  receivedAt: Date
}

const manifests = new Map<string, DeviceManifest>()

export const discoverySetManifest = (deviceKey: string, nodes: NodeInfo[]): void => {
  manifests.set(deviceKey, { deviceKey, nodes, receivedAt: new Date() })
}

export const discoveryGetAll = () => [...manifests.values()]

export const discoveryGetByDevice = (deviceKey: string) => manifests.get(deviceKey) ?? null
