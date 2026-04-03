import type { ITag } from '../tag/tag.model.js'

const cache = new Map<string, ITag>()

const key = (deviceKey: string, nodeId: string) => `${deviceKey}:${nodeId}`

export const bindingCacheSet = (tag: ITag): void => {
  if (!tag.binding?.nodeId) return
  cache.set(key(tag.binding.deviceKey, tag.binding.nodeId), tag)
}

export const bindingCacheGet = (deviceKey: string, nodeId: string): ITag | undefined =>
  cache.get(key(deviceKey, nodeId))

export const bindingCacheDelete = (deviceKey: string, nodeId: string): void => {
  cache.delete(key(deviceKey, nodeId))
}

export const bindingCacheInit = async (): Promise<void> => {
  const Tag = (await import('../tag/tag.model.js')).default
  const tags = await Tag.find({ 'binding.nodeId': { $ne: null } }).lean()
  for (const tag of tags) {
    bindingCacheSet(tag as ITag)
  }
}

export const bindingCacheSize = () => cache.size
