import { AuthError, type AuthUser, resolveAuthUser } from '@mes/auth'
import type http from 'http'
import { Server } from 'socket.io'
import { logger } from '../lib/logger.js'

let io: Server

const WORK_CENTER_ROOM_PREFIX = 'wc:'

// Work center rooms follow the same visibility rule as REST. Other rooms carry ID-only
// payloads, so clients still fetch the data through REST, which enforces visibility.
function canJoin(user: AuthUser, room: unknown): room is string {
  if (typeof room !== 'string') return false
  if (!room.startsWith(WORK_CENTER_ROOM_PREFIX)) return true
  const workCenterId = room.slice(WORK_CENTER_ROOM_PREFIX.length)
  return !user.workCenterIds || user.workCenterIds.includes(workCenterId)
}

export function initSocketServer(httpServer: http.Server): Server {
  io = new Server(httpServer, {
    transports: ['websocket'],
    cors: { origin: '*' },
  })

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token
    try {
      if (typeof token !== 'string' || !token) throw new AuthError(401, 'auth.unauthenticated')
      socket.data.user = await resolveAuthUser(token)
      next()
    } catch (error) {
      if (!(error instanceof AuthError)) {
        logger.error('Socket authentication failed unexpectedly', {
          event: 'socket.auth.error',
          error: error instanceof Error ? error.message : error,
        })
      }
      next(new Error('auth.unauthenticated'))
    }
  })

  io.on('connection', socket => {
    logger.debug('Client connected', {
      event: 'socket.client.connected',
      socketId: socket.id,
      userId: socket.data.user?.id,
    })

    socket.on('join', (data: { rooms?: unknown[] }, ack?: (res: { rooms: string[] }) => void) => {
      const rooms = data?.rooms
      if (!Array.isArray(rooms)) return

      // Leave all current rooms except the default socket.id room
      for (const room of socket.rooms) {
        if (room !== socket.id) socket.leave(room)
      }

      const allowed = rooms.filter(room => canJoin(socket.data.user, room))
      for (const room of allowed) {
        socket.join(room)
      }

      logger.debug('Client joined rooms', {
        event: 'socket.client.joined',
        socketId: socket.id,
        rooms: allowed,
        deniedCount: rooms.length - allowed.length,
      })

      if (typeof ack === 'function') ack({ rooms: allowed })
    })

    socket.on('disconnect', reason => {
      logger.debug('Client disconnected', {
        event: 'socket.client.disconnected',
        socketId: socket.id,
        reason,
      })
    })
  })

  logger.info('Socket.io server initialized (WebSocket-only)', {
    event: 'socket.server.initialized',
  })

  return io
}

export function getIO(): Server {
  return io
}
