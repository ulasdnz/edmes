import { z } from 'zod'

// Settings come from the environment only. The image and docker compose set them in a container;
// the dev scripts load the service's .env with --env-file-if-exists.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3001),
    MONGO_URI: z
      .string()
      .nonempty('MONGO_URI must be provided')
      .refine((val: string) => val.startsWith('mongodb://') || val.startsWith('mongodb+srv://'), {
        message: 'MONGO_URI must start with mongodb:// or mongodb+srv://',
      }),
    JWT_SECRET: z.string().nonempty('JWT_SECRET must be provided'),
    INTERNAL_API_TOKEN: z.string().min(32, 'INTERNAL_API_TOKEN must be at least 32 characters'),
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
    INTERNAL_API_USER: z.string().trim().min(1, 'INTERNAL_API_USER must be provided').pipe(z.url()),
    INTERNAL_API_PRODUCTION: z
      .string()
      .trim()
      .min(1, 'INTERNAL_API_PRODUCTION must be provided')
      .pipe(z.url()),
    PLANT_TIMEZONE: z
      .string()
      .trim()
      .min(1, 'PLANT_TIMEZONE must be provided')
      .refine(
        val => {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: val })
            return true
          } catch {
            return false
          }
        },
        { message: 'PLANT_TIMEZONE must be a valid IANA timezone (e.g. Europe/Istanbul)' },
      ),
  })
  .transform(data => ({
    ...data,
    MONGO_INDEX_STRATEGY:
      data.MONGO_INDEX_STRATEGY ?? (data.NODE_ENV === 'production' ? 'ensure' : 'off'),
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
