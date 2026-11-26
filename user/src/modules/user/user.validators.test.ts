import { describe, expect, it } from 'vitest'
import User from './user.model.js'
import { adminUpdateUserSchema, updateMeSchema } from './user.validators.js'

describe('updateMeSchema - birthDate (date-only)', () => {
  it('accepts valid YYYY-MM-DD and keeps it as a string', () => {
    const r = updateMeSchema.safeParse({ birthDate: '1990-05-15' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.birthDate).toBe('1990-05-15')
    expect(typeof r.data.birthDate).toBe('string')
  })

  it('treats undefined as valid (optional field)', () => {
    const r = updateMeSchema.safeParse({})
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.birthDate).toBeUndefined()
  })

  it('rejects offset-less datetime ("1990-05-15T08:00:00")', () => {
    const r = updateMeSchema.safeParse({ birthDate: '1990-05-15T08:00:00' })
    expect(r.success).toBe(false)
    if (r.success) return
    const messages = r.error.issues.map(i => i.message)
    expect(messages).toContain('validation.birth_date_format')
  })

  it('rejects UTC-Z datetime ("1990-05-15T00:00:00.000Z")', () => {
    const r = updateMeSchema.safeParse({ birthDate: '1990-05-15T00:00:00.000Z' })
    expect(r.success).toBe(false)
    if (r.success) return
    const messages = r.error.issues.map(i => i.message)
    expect(messages).toContain('validation.birth_date_format')
  })

  it('rejects slash-separated date ("05/15/1990")', () => {
    const r = updateMeSchema.safeParse({ birthDate: '05/15/1990' })
    expect(r.success).toBe(false)
  })

  it('rejects invalid calendar date ("1990-02-30")', () => {
    const r = updateMeSchema.safeParse({ birthDate: '1990-02-30' })
    expect(r.success).toBe(false)
    if (r.success) return
    const messages = r.error.issues.map(i => i.message)
    expect(messages).toContain('validation.birth_date_invalid')
  })

  it('rejects month overflow ("1990-13-01")', () => {
    const r = updateMeSchema.safeParse({ birthDate: '1990-13-01' })
    expect(r.success).toBe(false)
  })
})

describe('gender has two values', () => {
  // scenario: UserGender.twoValues / constraints / [HIGH] both schemas accept female and male, reject other
  it.each([
    ['updateMeSchema', updateMeSchema],
    ['adminUpdateUserSchema', adminUpdateUserSchema],
  ] as const)('%s accepts female and male and rejects other', (_name, schema) => {
    expect(schema.safeParse({ gender: 'female' }).success).toBe(true)
    expect(schema.safeParse({ gender: 'male' }).success).toBe(true)
    expect(schema.safeParse({ gender: 'other' }).success).toBe(false)
  })

  // scenario: UserGender.twoValues / constraints / the model enum is exactly male, female
  it('the user model allows exactly male and female, and refuses to save other', async () => {
    const path = User.schema.path('gender') as unknown as { enumValues: string[] }
    expect(path.enumValues).toEqual(['male', 'female'])

    const user = new User({
      username: 'gender.other',
      email: 'gender.other@example.com',
      password: 'not-a-real-hash',
      name: 'Gender',
      surname: 'Other',
      gender: 'other',
    })
    await expect(user.save()).rejects.toMatchObject({ name: 'ValidationError' })
    expect(await User.countDocuments({ username: 'gender.other' })).toBe(0)
  })
})
