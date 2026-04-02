import { config } from './config/index.js'
import { initLoaders } from './core/loaders/index.js'
import { logger } from './lib/logger.js'
import { closeRedis } from './lib/redis.js'
import { isShuttingDown, setShuttingDown } from './lib/shutdown.js'
import { disconnectDB } from './utils/db.js'

const SHUTDOWN_TIMEOUT_MS = 8000

const startServer = async (): Promise<void> => {
  try {
    const app = await initLoaders()

    const server = app.listen(config.PORT, () => {
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

      server.close(async () => {
        logger.info('HTTP server closed', { event: 'server.http.closed' })

        try {
          await Promise.all([disconnectDB(), closeRedis()])
          logger.info('Data connections closed', { event: 'server.shutdown.completed' })
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

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
  } catch (error) {
    logger.error('Failed to start server', {
      event: 'server.start.failed',
      error: error instanceof Error ? error.message : error,
    })
    process.exit(1)
  }
}

process.on('unhandledRejection', (reason: unknown) => {
  const error = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  logger.error('Unhandled Promise Rejection', {
    event: 'process.unhandled_rejection',
    error,
    stack,
  })
  process.exit(1)
})

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception', {
    event: 'process.uncaught_exception',
    error: error.message,
    stack: error.stack,
  })
  process.exit(1)
})

startServer()
