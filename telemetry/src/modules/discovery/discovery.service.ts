import { discoveryGetAll, discoveryGetByDevice } from './discovery.cache.js'
import Tag from '../tag/tag.model.js'

const keyOf = (deviceKey: string, nodeId: string) => `${deviceKey}::${nodeId}`

const filterAvailableNodes = async <
  T extends { deviceKey: string; nodes: Array<{ nodeId: string; name: string; dataType?: string }> },
>(
  manifests: T[],
): Promise<T[]> => {
  const boundTags = await Tag.find({
    'binding.deviceKey': { $type: 'string' },
    'binding.nodeId': { $type: 'string' },
  })
    .select({ _id: 0, 'binding.deviceKey': 1, 'binding.nodeId': 1 })
    .lean()

  const usedBindings = new Set(
    boundTags.flatMap(tag =>
      tag.binding?.deviceKey && tag.binding?.nodeId
        ? [keyOf(tag.binding.deviceKey, tag.binding.nodeId)]
        : [],
    ),
  )

  return manifests
    .map(manifest => ({
      ...manifest,
      nodes: manifest.nodes.filter(node => !usedBindings.has(keyOf(manifest.deviceKey, node.nodeId))),
    }))
    .filter(manifest => manifest.nodes.length > 0)
}

export const getDiscoveryManifests = async (availableOnly: boolean) => {
  const manifests = discoveryGetAll()
  if (!availableOnly) return manifests
  return filterAvailableNodes(manifests)
}

export const getDiscoveryManifestByDevice = async (deviceKey: string, availableOnly: boolean) => {
  const manifest = discoveryGetByDevice(deviceKey)
  if (!manifest) return null
  if (!availableOnly) return manifest

  const [filteredManifest] = await filterAvailableNodes([manifest])
  return filteredManifest ?? {
    ...manifest,
    nodes: [],
  }
}
