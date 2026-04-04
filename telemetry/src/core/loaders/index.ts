import { CustomError } from '../../core/errors/index.js'
import { initSubscribers } from '../../jobs/subscribers.js'
import { logger } from '../../lib/logger.js'
import { initMqtt, onMqttMessage } from '../../lib/mqtt.js'
import { initRedis } from '../../lib/redis.js'
import { discoverySetManifest } from '../../modules/discovery/discovery.cache.js'
import EdgeDevice from '../../modules/edge-device/edge-device.model.js'
import '../../modules/ingestion/current-state.model.js'
import { bindingCacheInit } from '../../modules/ingestion/binding-cache.js'
import { processMessage } from '../../modules/ingestion/ingestion.pipeline.js'
import '../../modules/tag/tag.model.js'
import '../../modules/tag-type/tag-type.model.js'
import { initExpress } from './express.js'
import { initMongoose } from './mongoose.js'

export const initLoaders = async () => {
  try {
    logger.info('Initializing application loaders', { event: 'loader.init.started' })

    await initMongoose()
    await initRedis()
    initSubscribers()
    await bindingCacheInit()
    await initMqtt()

    onMqttMessage((topic, payload) => {
      if (topic.startsWith('devices/')) {
        processMessage(topic, payload).catch(err => {
          if (err instanceof CustomError && err.message === 'historian.period_locked') {
            logger.debug('Ingestion rejected: period locked', {
              event: 'ingestion.period_locked',
              topic,
            })
            return
          }
          logger.error('Ingestion error', {
            event: 'ingestion.error',
            topic,
            error: err instanceof Error ? err.message : err,
          })
        })
      } else if (topic.startsWith('discovery/')) {
        const parts = topic.split('/')
        const deviceKey = parts[1]
        const type = parts[2]

        if (type === 'manifest') {
          try {
            const data = JSON.parse(payload.toString())
            discoverySetManifest(deviceKey, data.nodes ?? [])
          } catch {
            logger.debug('Malformed discovery manifest', {
              event: 'discovery.manifest.malformed',
              deviceKey,
            })
          }
        } else if (type === 'status') {
          const status = payload.toString()
          EdgeDevice.findOneAndUpdate({ deviceKey }, { status }).catch(err => {
            logger.warn('EdgeDevice status update failed', {
              event: 'discovery.status.update_failed',
              deviceKey,
              error: err instanceof Error ? err.message : err,
            })
          })
        }
      }
    })

    const app = await initExpress()

    logger.info('All loaders initialized successfully', { event: 'loader.init.completed' })
    return app
  } catch (error) {
    logger.error('Loader initialization failed', {
      event: 'loader.init.failed',
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    process.exit(1)
  }
}
