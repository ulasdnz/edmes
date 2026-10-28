process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret-32-chars-minimum-ok!'
process.env.INTERNAL_API_TOKEN = 'test-internal-api-token-at-least-32-chars'
process.env.LOG_LEVEL = 'error'
process.env.INTERNAL_API_USER = 'http://127.0.0.1:19901'
process.env.INTERNAL_API_WORK_CENTER = 'http://127.0.0.1:19902'
process.env.INTERNAL_API_PRODUCTION = 'http://127.0.0.1:19903'
process.env.INTERNAL_API_TELEMETRY = 'http://127.0.0.1:19904'
// MONGO_URI and REDIS_URL are set by contract-setup.ts beforeAll,
// but config validates at import time — so we set plausible placeholders here.
// The actual connection strings are overridden in beforeAll before mongoose.connect().
if (!process.env.MONGO_URI) {
  process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test-placeholder'
}
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = 'redis://127.0.0.1:6379'
}
