import { describe, expect, it, vi, beforeEach } from 'vitest'
import http from 'http'
import { Server } from 'socket.io'
import { initSocketServer, getIO } from './socket.js'

vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

function createMockSocket() {
  const rooms = new Set<string>()
  const id = `socket-${Math.random().toString(36).slice(2, 8)}`
  rooms.add(id)

  return {
    id,
    rooms,
    join: vi.fn((room: string) => rooms.add(room)),
    leave: vi.fn((room: string) => rooms.delete(room)),
    on: vi.fn(),
  }
}

describe('SocketServer', () => {
  let httpServer: http.Server
  let io: Server

  beforeEach(() => {
    httpServer = http.createServer()
    io = initSocketServer(httpServer)
  })

  afterEach(() => {
    io.close()
    httpServer.close()
  })

  // ── configuration ───────────────────────────────────────────────────

  describe('configuration', () => {
    it("sets transports to ['websocket'] only", () => {
      const opts = (io as any).opts
      expect(opts.transports).toEqual(['websocket'])
    })

    it("sets CORS origin to '*'", () => {
      const opts = (io as any).opts
      expect(opts.cors.origin).toBe('*')
    })
  })

  // ── joinHandler ─────────────────────────────────────────────────────

  describe('joinHandler', () => {
    function getConnectionHandler(): (socket: any) => void {
      const connectionListeners = (io as any)._events?.connection || (io as any).listeners('connection')
      return Array.isArray(connectionListeners) ? connectionListeners[0] : connectionListeners
    }

    it('joins multiple rooms when client emits join with rooms array', () => {
      const socket = createMockSocket()
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]
      joinHandler({ rooms: ['wc:abc', 'job_order'] })

      expect(socket.join).toHaveBeenCalledWith('wc:abc')
      expect(socket.join).toHaveBeenCalledWith('job_order')
    })

    it('joins a single room when client emits join with one room', () => {
      const socket = createMockSocket()
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]
      joinHandler({ rooms: ['production_plan'] })

      expect(socket.join).toHaveBeenCalledWith('production_plan')
    })

    it('leaves all non-default rooms before joining new ones', () => {
      const socket = createMockSocket()
      socket.rooms.add('old_room')
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]
      joinHandler({ rooms: ['new_room'] })

      expect(socket.leave).toHaveBeenCalledWith('old_room')
      expect(socket.leave).not.toHaveBeenCalledWith(socket.id)
    })

    it('never leaves the default socket.id room', () => {
      const socket = createMockSocket()
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]
      joinHandler({ rooms: ['wc:abc'] })

      expect(socket.leave).not.toHaveBeenCalledWith(socket.id)
    })

    it('is a no-op when rooms is not an array', () => {
      const socket = createMockSocket()
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]
      joinHandler({ rooms: 'not-an-array' })

      expect(socket.join).not.toHaveBeenCalled()
    })

    it('leaves all non-default rooms and joins none when rooms is empty array', () => {
      const socket = createMockSocket()
      socket.rooms.add('old_room')
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]
      joinHandler({ rooms: [] })

      expect(socket.leave).toHaveBeenCalledWith('old_room')
      expect(socket.join).not.toHaveBeenCalled()
    })

    it('joins exactly one room when rooms has single entry', () => {
      const socket = createMockSocket()
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]
      joinHandler({ rooms: ['wc:abc'] })

      expect(socket.join).toHaveBeenCalledTimes(1)
      expect(socket.join).toHaveBeenCalledWith('wc:abc')
    })

    it('replaces rooms from first join call with rooms from second join call', () => {
      const socket = createMockSocket()
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]

      joinHandler({ rooms: ['room_a'] })
      expect(socket.join).toHaveBeenCalledWith('room_a')

      socket.leave.mockClear()
      socket.join.mockClear()

      joinHandler({ rooms: ['room_b'] })
      expect(socket.leave).toHaveBeenCalledWith('room_a')
      expect(socket.join).toHaveBeenCalledWith('room_b')
    })

    it('is a no-op when rooms field is missing', () => {
      const socket = createMockSocket()
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]
      joinHandler({})

      expect(socket.join).not.toHaveBeenCalled()
    })

    it('is a no-op when rooms is a string instead of array', () => {
      const socket = createMockSocket()
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]
      joinHandler({ rooms: 'wc:abc' })

      expect(socket.join).not.toHaveBeenCalled()
    })

    it('is a no-op when rooms is null', () => {
      const socket = createMockSocket()
      const handler = getConnectionHandler()
      handler(socket)

      const joinHandler = socket.on.mock.calls.find(([event]: [string]) => event === 'join')?.[1]
      joinHandler({ rooms: null })

      expect(socket.join).not.toHaveBeenCalled()
    })
  })
})
