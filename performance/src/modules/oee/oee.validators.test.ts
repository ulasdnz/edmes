import { describe, expect, it } from 'vitest'
import { oeeQuerySchema } from './oee.validators.js'

const VALID_WC = 'aaaaaaaaaaaaaaaaaaaaaaaa'

describe('oeeQuerySchema', () => {
  it('parses a valid query and transforms from/to into Date instances', () => {
    const r = oeeQuerySchema.safeParse({
      workCenterId: VALID_WC,
      from: '2026-04-01T10:00:00.000Z',
      to: '2026-04-01T11:00:00.000Z',
    })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.workCenterId).toBe(VALID_WC)
    expect(r.data.from).toBeInstanceOf(Date)
    expect(r.data.to).toBeInstanceOf(Date)
    expect(r.data.from.toISOString()).toBe('2026-04-01T10:00:00.000Z')
    expect(r.data.to.toISOString()).toBe('2026-04-01T11:00:00.000Z')
  })

  it('rejects offset-less from string', () => {
    const r = oeeQuerySchema.safeParse({
      workCenterId: VALID_WC,
      from: '2026-04-01T10:00:00',
      to: '2026-04-01T11:00:00.000Z',
    })
    expect(r.success).toBe(false)
    if (r.success) return
    const messages = r.error.issues.map(i => i.message)
    expect(messages).toContain('validation.datetime_utc_z_required')
  })

  it('rejects date-only from string', () => {
    const r = oeeQuerySchema.safeParse({
      workCenterId: VALID_WC,
      from: '2026-04-01',
      to: '2026-04-02',
    })
    expect(r.success).toBe(false)
  })

  it('rejects to === from', () => {
    const r = oeeQuerySchema.safeParse({
      workCenterId: VALID_WC,
      from: '2026-04-01T10:00:00.000Z',
      to: '2026-04-01T10:00:00.000Z',
    })
    expect(r.success).toBe(false)
    if (r.success) return
    const issue = r.error.issues.find(i => i.path.includes('to'))
    expect(issue?.message).toBe('error.invalid_range')
  })

  it('rejects to < from', () => {
    const r = oeeQuerySchema.safeParse({
      workCenterId: VALID_WC,
      from: '2026-04-01T11:00:00.000Z',
      to: '2026-04-01T10:00:00.000Z',
    })
    expect(r.success).toBe(false)
    if (r.success) return
    const issue = r.error.issues.find(i => i.path.includes('to'))
    expect(issue?.message).toBe('error.invalid_range')
  })
})
