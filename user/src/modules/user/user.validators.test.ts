import { describe, expect, it } from 'vitest'
import { updateMeSchema } from './user.validators.js'

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
