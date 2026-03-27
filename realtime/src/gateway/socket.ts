import type http from 'http'
import { Server } from 'socket.io'
import { logger } from '../lib/logger.js'

let io: Server

export function initSocketServer(httpServer: http.Server): Server {
  io = new Server(httpServer, {
    transports: ['websocket'],
    cors: { origin: '*' },
  })

  io.on('connection', socket => {
    logger.debug('Client connected', {
      event: 'socket.client.connected',
      socketId: socket.id,
    })

    socket.on('join', (data: { rooms?: string[] }) => {
      const rooms = data?.rooms
      if (!Array.isArray(rooms)) return

      // Leave all current rooms except the default socket.id room
      for (const room of socket.rooms) {
        if (room !== socket.id) socket.leave(room)
      }

      for (const room of rooms) {
        socket.join(room)
      }

      logger.debug('Client joined rooms', {
        event: 'socket.client.joined',
        socketId: socket.id,
        rooms,
      })
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
