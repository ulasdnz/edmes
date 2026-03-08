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
  // Always try to load gracefully to avoid missing env errors if path is mapped in docker
  dotenv.config()
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    MONGO_URI: z
      .string()
      .nonempty('MONGO_URI must be provided')
      .refine((val: string) => val.startsWith('mongodb://') || val.startsWith('mongodb+srv://'), {
        message: 'MONGO_URI must start with mongodb:// or mongodb+srv://',
      }),
    JWT_SECRET: z.string().nonempty('JWT_SECRET must be provided'),
    JWT_EXPIRES_IN: z.string().default('1d'),
    LOG_LEVEL: z.string().default('info'),
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
        {
          message: 'REDIS_URL must be a valid redis URL like redis://host:port',
        },
      ),
    MONGO_INDEX_STRATEGY: z.enum(['off', 'ensure']).optional(),
    USER_DELETION_RETENTION_DAYS: z.coerce.number().default(30),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().default(5),
    LOGIN_BLOCKING_DURATION_MS: z.coerce.number().default(300_000), // 5 minutes
    INTERNAL_API_USER: z.string().url().nonempty('INTERNAL_API_USER must be provided'),
  })
  .transform(data => ({
    ...data,
    MONGO_INDEX_STRATEGY:
      data.MONGO_INDEX_STRATEGY ?? (data.NODE_ENV === 'production' ? 'ensure' : 'off'),
    USER_DELETION_RETENTION_MS: data.USER_DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  }))

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables')
  for (const issue of parsed.error.issues) {
    console.error(`- ${issue.path.join('.')} : ${issue.message}`)
  }
  process.exit(1)
}
export const config = parsed.data
