import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDiscoveryManifestByDevice, getDiscoveryManifests } from './discovery.service.js'

const { discoveryGetAllMock, discoveryGetByDeviceMock, findMock, selectMock, leanMock } =
  vi.hoisted(() => {
    const leanMock = vi.fn()
    const selectMock = vi.fn(() => ({ lean: leanMock }))
    const findMock = vi.fn(() => ({ select: selectMock }))

    return {
      discoveryGetAllMock: vi.fn(),
      discoveryGetByDeviceMock: vi.fn(),
      findMock,
      selectMock,
      leanMock,
    }
  })

vi.mock('./discovery.cache.js', () => ({
  discoveryGetAll: discoveryGetAllMock,
  discoveryGetByDevice: discoveryGetByDeviceMock,
}))

vi.mock('../tag/tag.model.js', () => ({
  default: {
    find: findMock,
  },
}))

describe('discovery.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns manifests unchanged when availableOnly is false', async () => {
    const manifests = [
      {
        deviceKey: 'press-line-1',
        nodes: [{ nodeId: 'counter01', name: 'Press Counter', dataType: 'Int32' }],
        manifestReceivedAt: new Date('2026-04-05T10:36:47.316Z'),
      },
    ]

    discoveryGetAllMock.mockReturnValue(manifests)

    await expect(getDiscoveryManifests(false)).resolves.toEqual(manifests)
    expect(findMock).not.toHaveBeenCalled()
  })

  it('filters out nodes already bound to tags', async () => {
    discoveryGetAllMock.mockReturnValue([
      {
        deviceKey: 'press-line-1',
        nodes: [
          { nodeId: 'counter01', name: 'Press Counter', dataType: 'Int32' },
          { nodeId: 'speed01', name: 'Line Speed', dataType: 'Double' },
        ],
        manifestReceivedAt: new Date('2026-04-05T10:36:47.316Z'),
      },
    ])
    leanMock.mockResolvedValue([
      {
        binding: { deviceKey: 'press-line-1', nodeId: 'counter01' },
      },
    ])

    await expect(getDiscoveryManifests(true)).resolves.toEqual([
      {
        deviceKey: 'press-line-1',
        nodes: [{ nodeId: 'speed01', name: 'Line Speed', dataType: 'Double' }],
        manifestReceivedAt: new Date('2026-04-05T10:36:47.316Z'),
      },
    ])
  })

  it('returns an empty node list for a device whose nodes are all bound', async () => {
    discoveryGetByDeviceMock.mockReturnValue({
      deviceKey: 'press-line-1',
      nodes: [{ nodeId: 'counter01', name: 'Press Counter', dataType: 'Int32' }],
      manifestReceivedAt: new Date('2026-04-05T10:36:47.316Z'),
    })
    leanMock.mockResolvedValue([
      {
        binding: { deviceKey: 'press-line-1', nodeId: 'counter01' },
      },
    ])

    await expect(getDiscoveryManifestByDevice('press-line-1', true)).resolves.toEqual({
      deviceKey: 'press-line-1',
      nodes: [],
      manifestReceivedAt: new Date('2026-04-05T10:36:47.316Z'),
    })
  })
})
