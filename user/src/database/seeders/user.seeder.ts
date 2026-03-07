import { faker } from '@faker-js/faker'
import bcrypt from 'bcryptjs'
import { logger } from '../../lib/logger.js'
import User from '../../modules/user/user.model.js'
import { connectDB, disconnectDB } from '../../utils/db.js'

interface SeedUser {
  name: string
  surname: string
  email: string
  password: string
  role: 'user' | 'admin'
  gender?: 'male' | 'female' | 'other'
  countryCode?: string
  birthDate?: Date
  photoUrl: string
  isActivated: boolean
}

async function generateUsers(count: number): Promise<SeedUser[]> {
  const hashedPassword = await bcrypt.hash('Test123456', 10)

  const users: SeedUser[] = Array.from({ length: count }, (_, index) => {
    const gender = faker.helpers.arrayElement(['male', 'female'] as const)

    return {
      name: faker.person.firstName(gender),
      surname: faker.person.lastName(),
      email: faker.internet.email().toLowerCase(),
      password: hashedPassword,
      role: index === 0 ? 'admin' : 'user', // First user is admin
      gender: faker.helpers.arrayElement(['male', 'female', 'other']),
      countryCode: faker.location.countryCode(),
      birthDate: faker.date.birthdate({ min: 18, max: 65, mode: 'age' }),
      photoUrl:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Node.js_logo.svg/1200px-Node.js_logo.svg.png',
      isActivated: true,
    }
  })

  return users
}

export async function seedUsers(count = 10) {
  try {
    await connectDB()

    logger.info('🌱 Starting user seeding...')

    await User.deleteMany({})
    logger.info('🧹 Cleared existing users collection')

    const users = await generateUsers(count)
    await User.insertMany(users)

    logger.info(`✅ Inserted ${users.length} users successfully`)
    logger.info(`   - 1 admin user`)
    logger.info(`   - ${users.length - 1} regular users`)
    logger.info(`   - Test password for all: "Test123456"`)
  } catch (error) {
    logger.error('❌ User seeding failed:', error)
    throw error
  } finally {
    await disconnectDB()
  }
}
