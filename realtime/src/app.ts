import http from 'http'
import { config } from './config/index.js'
import { initLoaders } from './core/loaders/index.js'
import { initSocketServer } from './gateway/socket.js'
import { initSubscribers, shutdownSubscribers } from './jobs/subscribers.js'
import { logger } from './lib/logger.js'
import { closeRedis } from './lib/redis.js'
import { isShuttingDown, setShuttingDown } from './lib/shutdown.js'

const SHUTDOWN_TIMEOUT_MS = 8000

const startServer = async (): Promise<void> => {
  try {
    const app = await initLoaders()

    const httpServer = http.createServer(app)
    initSocketServer(httpServer)
    initSubscribers()

    httpServer.listen(config.PORT, () => {
      logger.info('Server started', { event: 'server.start', port: config.PORT })
    })

    const shutdown = async (signal?: NodeJS.Signals): Promise<void> => {
      if (isShuttingDown) return
      setShuttingDown()

      logger.info('Gracefully shutting down', { event: 'server.shutdown.start', signal })

      const forceExitTimer = setTimeout(() => {
        logger.error('Shutdown timed out, forcing exit', {
          event: 'server.shutdown.timeout',
          timeoutMs: SHUTDOWN_TIMEOUT_MS,
        })
        process.exit(1)
      }, SHUTDOWN_TIMEOUT_MS)
      forceExitTimer.unref()

      httpServer.close(async () => {
        logger.info('HTTP server closed', { event: 'server.http.closed' })

        try {
          await Promise.all([closeRedis(), shutdownSubscribers()])
          logger.info('Connections closed', { event: 'server.shutdown.completed' })
          process.exit(0)
        } catch (err) {
          logger.error('Error during shutdown cleanup', {
            event: 'server.shutdown.failed',
            error: err instanceof Error ? err.message : err,
          })
          process.exit(1)
        }
      })
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  } catch (err) {
    logger.error('Failed to start server', {
      event: 'server.start.failed',
      error: err instanceof Error ? err.message : err,
      stack: err instanceof Error ? err.stack : undefined,
    })
    process.exit(1)
  }
}

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled rejection', {
    event: 'process.unhandled_rejection',
    error: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  })
  process.exit(1)
})

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', {
    event: 'process.uncaught_exception',
    error: error.message,
    stack: error.stack,
  })
  process.exit(1)
})

startServer()
