import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envPath = path.resolve(__dirname, '../../.env')
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3003),
  LOG_LEVEL: z.string().default('info'),
  JWT_SECRET: z.string().nonempty('JWT_SECRET must be provided'),
  INTERNAL_API_TOKEN: z.string().min(32, 'INTERNAL_API_TOKEN must be at least 32 characters'),
  INTERNAL_API_USER: z.string().trim().min(1, 'INTERNAL_API_USER must be provided').pipe(z.url()),
  REDIS_URL: z
    .string()
    .nonempty('REDIS_URL must be provided')
    .refine(
      val => {
        try {
          const url = new URL(val)
          return (url.protocol === 'redis:' || url.protocol === 'rediss:') && !!url.host
        } catch {
          return false
        }
      },
      { message: 'REDIS_URL must be a valid redis URL like redis://host:port' },
    ),
  STREAM_CONSUMER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  STREAM_CONSUMER_BLOCK_MS: z.coerce.number().int().min(0).default(5000),
  STREAM_CONSUMER_RECLAIM_MIN_IDLE_MS: z.coerce.number().int().positive().default(30000),
  STREAM_CONSUMER_RECLAIM_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  STREAM_CONSUMER_MAX_DELIVERIES: z.coerce.number().int().positive().default(5),
})

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Environment validation failed:')
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const config = result.data
