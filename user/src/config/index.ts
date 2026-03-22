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
    INTERNAL_API_USER: z.string().trim().min(1, 'INTERNAL_API_USER must be provided').pipe(z.url()),
    SYSTEM_ADMIN_BOOTSTRAP_ENABLED: z.enum(['true', 'false']).optional(),
    SYSTEM_ADMIN_ROLE_NAME: z
      .string()
      .trim()
      .min(2, 'SYSTEM_ADMIN_ROLE_NAME must be at least 2 characters')
      .max(50, 'SYSTEM_ADMIN_ROLE_NAME must be at most 50 characters')
      .default('System Administrator'),
    SYSTEM_ADMIN_USERNAME: z
      .string()
      .trim()
      .min(3, 'SYSTEM_ADMIN_USERNAME must be at least 3 characters')
      .max(30, 'SYSTEM_ADMIN_USERNAME must be at most 30 characters')
      .default('system.admin'),
    SYSTEM_ADMIN_NAME: z
      .string()
      .trim()
      .min(2, 'SYSTEM_ADMIN_NAME must be at least 2 characters')
      .max(24, 'SYSTEM_ADMIN_NAME must be at most 24 characters')
      .default('System'),
    SYSTEM_ADMIN_SURNAME: z
      .string()
      .trim()
      .min(1, 'SYSTEM_ADMIN_SURNAME must be provided')
      .default('Administrator'),
    SYSTEM_ADMIN_EMAIL: z
      .string()
      .trim()
      .min(1, 'SYSTEM_ADMIN_EMAIL must be a valid email')
      .pipe(z.email('SYSTEM_ADMIN_EMAIL must be a valid email'))
      .default('system.admin@example.local'),
    SYSTEM_ADMIN_PASSWORD: z
      .string()
      .trim()
      .optional()
      .transform(value => (value ? value : undefined))
      .refine(value => value === undefined || (value.length >= 8 && value.length <= 20), {
        message: 'SYSTEM_ADMIN_PASSWORD must be 8-20 characters when provided',
      }),
  })
  .transform(data => ({
    ...data,
    MONGO_INDEX_STRATEGY:
      data.MONGO_INDEX_STRATEGY ?? (data.NODE_ENV === 'production' ? 'ensure' : 'off'),
    USER_DELETION_RETENTION_MS: data.USER_DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    SYSTEM_ADMIN_BOOTSTRAP_ENABLED: (data.SYSTEM_ADMIN_BOOTSTRAP_ENABLED ?? 'true') === 'true',
  }))
  .refine(
    data =>
      !(
        data.NODE_ENV === 'production' &&
        data.SYSTEM_ADMIN_BOOTSTRAP_ENABLED &&
        !data.SYSTEM_ADMIN_PASSWORD
      ),
    {
      message: 'SYSTEM_ADMIN_PASSWORD is required in production when bootstrap is enabled',
      path: ['SYSTEM_ADMIN_PASSWORD'],
    },
  )

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables')
  for (const issue of parsed.error.issues) {
    console.error(`- ${issue.path.join('.')} : ${issue.message}`)
  }
  process.exit(1)
}
export const config = parsed.data
