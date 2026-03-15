import { faker } from '@faker-js/faker'
import bcrypt from 'bcryptjs'
import { logger } from '../../lib/logger.js'
import User from '../../modules/user/user.model.js'

const DEFAULT_PASSWORD = 'Test123456'

export async function seedUsers(count = 10) {
  logger.info('Starting user seeding...', { event: 'seed.user.start' })

  await User.deleteMany({})
  logger.info('Cleared existing users collection', { event: 'seed.user.cleared' })

  const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10)

  const users = Array.from({ length: count }, (_, i) => {
    const gender = faker.helpers.arrayElement(['male', 'female'] as const)
    const firstName = faker.person.firstName(gender)
    const lastName = faker.person.lastName()

    return {
      username: faker.internet.username({ firstName, lastName }).toLowerCase(),
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
      password: hashedPassword,
      name: firstName,
      surname: lastName,
      gender: faker.helpers.arrayElement(['male', 'female', 'other'] as const),
      countryCode: faker.location.countryCode(),
      birthDate: faker.date.birthdate({ min: 18, max: 65, mode: 'age' }),
      language: i === 0 ? 'tr' : faker.helpers.arrayElement(['en', 'tr'] as const),
      isActivated: true,
    }
  })

  await User.insertMany(users)

  logger.info(`Inserted ${users.length} users successfully`, {
    event: 'seed.user.completed',
    count: users.length,
    testPassword: DEFAULT_PASSWORD,
  })
}
