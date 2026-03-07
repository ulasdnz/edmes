import { config } from './config/index.js'
import { initLoaders } from './core/loaders/index.js'
import { logger } from './lib/logger.js'
import { closeRedis } from './lib/redis.js'
import { isShuttingDown, setShuttingDown } from './lib/shutdown.js'
import { shutdownWorkers } from './jobs/workers.js'
import { disconnectDB } from './utils/db.js'

const SHUTDOWN_TIMEOUT_MS = 8000

const startServer = async (): Promise<void> => {
  try {
    const app = await initLoaders()

    const server = app.listen(config.PORT, () => {
      logger.info(`Server running on port ${config.PORT}`)
    })

    const shutdown = async (signal?: NodeJS.Signals): Promise<void> => {
      if (isShuttingDown) return // Prevent double shutdown
      setShuttingDown()

      logger.info(`Received ${signal}. Gracefully shutting down...`)

      // Safety net: force exit if cleanup takes too long
      const forceExitTimer = setTimeout(() => {
        logger.error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`)
        process.exit(1)
      }, SHUTDOWN_TIMEOUT_MS)
      forceExitTimer.unref() // Don't keep process alive just for this timer

      server.close(async () => {
        logger.info('HTTP server closed — no longer accepting connections')

        try {
          await Promise.all([disconnectDB(), closeRedis(), shutdownWorkers()])
          logger.info('Data connections (Mongo & Redis) closed')
          process.exit(0)
        } catch (err) {
          logger.error('Error during shutdown cleanup', err)
          process.exit(1)
        }
      })
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
  } catch (error) {
    logger.error('Failed to start server', error)
    process.exit(1)
  }
}

process.on('unhandledRejection', (reason: unknown) => {
  if (reason instanceof Error) {
    logger.error('Unhandled Promise Rejection:', reason.message, reason.stack)
  } else {
    logger.error('Unhandled Promise Rejection:', reason)
  }
  process.exit(1)
})

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error.message, error.stack)
  process.exit(1)
})

startServer()
