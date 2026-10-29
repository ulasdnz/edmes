import { AuthError, type AuthUser, resolveAuthUser } from '@mes/auth'
import type http from 'http'
import { Server } from 'socket.io'
import { logger } from '../lib/logger.js'
import { workCenterIdsOf } from './router.js'

let io: Server

const WORK_CENTER_ROOM_PREFIX = 'wc:'

// Events carry IDs only, so REST enforces access when the client fetches the data.
// tag.value.recorded is the exception: it carries the measurement itself, so it needs the
// same permission as the historian API.
const EVENT_PERMISSIONS: Record<string, string> = {
  'tag.value.recorded': 'readHistorian',
}

// Open sockets outlive the auth state they connected with (deactivation, password reset,
// role or work center changes, token expiry), so every socket is checked again on this interval.
const AUTH_RECHECK_INTERVAL_MS = 30_000

function canSeeWorkCenter(user: AuthUser, workCenterId: string): boolean {
  return !user.workCenterIds || user.workCenterIds.includes(workCenterId)
}

// Work center rooms follow the same visibility rule as REST. Entity rooms are open to every
// user; emitToRooms decides what each subscriber actually receives.
function canJoin(user: AuthUser, room: unknown): room is string {
  if (typeof room !== 'string') return false
  if (!room.startsWith(WORK_CENTER_ROOM_PREFIX)) return true
  return canSeeWorkCenter(user, room.slice(WORK_CENTER_ROOM_PREFIX.length))
}

// A socket receives an event only if the same user could see it through REST. Any visible work
// center is enough, so the previous owner of a moved record still hears about the move.
function canReceive(user: AuthUser, type: string, payload: Record<string, unknown>): boolean {
  const permission = EVENT_PERMISSIONS[type]
  if (permission && !user.permissions.includes('*') && !user.permissions.includes(permission)) {
    return false
  }
  const workCenterIds = workCenterIdsOf(payload)
  return workCenterIds.length === 0 || workCenterIds.some(id => canSeeWorkCenter(user, id))
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
      socket.data.token = token
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

  setInterval(() => void recheckConnections(), AUTH_RECHECK_INTERVAL_MS).unref()

  logger.info('Socket.io server initialized (WebSocket-only)', {
    event: 'socket.server.initialized',
  })

  return io
}

// Rooms say who is interested; canReceive decides who may see it. Emitting per socket costs more
// than a room broadcast, but stops entity rooms (e.g. job_order) from leaking hidden work centers.
export async function emitToRooms(
  rooms: string[],
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const sockets = await io.in(rooms).fetchSockets()
  for (const socket of sockets) {
    if (canReceive(socket.data.user, type, payload)) socket.emit(type, payload)
  }
}

// Re-resolves every open socket through the same cached auth context as REST. Rejected tokens
// are disconnected; infrastructure errors keep the last known auth until the next recheck.
export async function recheckConnections(): Promise<void> {
  const failures: unknown[] = []

  await Promise.all(
    [...io.sockets.sockets.values()].map(async socket => {
      try {
        socket.data.user = await resolveAuthUser(socket.data.token)
      } catch (error) {
        if (!(error instanceof AuthError)) {
          failures.push(error)
          return
        }
        logger.info('Socket disconnected after auth change', {
          event: 'socket.auth.revoked',
          socketId: socket.id,
          userId: socket.data.user?.id,
        })
        socket.disconnect(true)
      }
    }),
  )

  if (failures.length > 0) {
    logger.warn('Socket auth recheck failed', {
      event: 'socket.auth.recheck_failed',
      failedCount: failures.length,
      error: failures[0] instanceof Error ? failures[0].message : failures[0],
    })
  }
}

export function getIO(): Server {
  return io
}
