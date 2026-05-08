import '../../test/contract-setup.js'

import { describe, expect, it } from 'vitest'
import { oeeQuerySchema } from '../oee/oee.validators.js'

describe('datetime validation — offset-less strings must be rejected', () => {
  const VALID_WC = 'aaaaaaaaaaaaaaaaaaaaaaaa'

  it('rejects missing Z suffix', () => {
    const r = oeeQuerySchema.safeParse({
      workCenterId: VALID_WC,
      from: '2026-01-01T06:00:00',
      to: '2026-01-01T07:00:00',
    })
    expect(r.success).toBe(false)
    const messages = r.error!.issues.map(i => i.message)
    expect(messages).toContain('validation.datetime_utc_z_required')
  })

  it('rejects space-separated datetime', () => {
    const r = oeeQuerySchema.safeParse({
      workCenterId: VALID_WC,
      from: '2026-01-01 06:00:00',
      to: '2026-01-01 07:00:00',
    })
    expect(r.success).toBe(false)
  })

  it('rejects date-only string', () => {
    const r = oeeQuerySchema.safeParse({
      workCenterId: VALID_WC,
      from: '2026-01-01',
      to: '2026-01-02',
    })
    expect(r.success).toBe(false)
  })

  it('accepts valid UTC ISO strings with Z suffix', () => {
    const r = oeeQuerySchema.safeParse({
      workCenterId: VALID_WC,
      from: '2026-01-01T06:00:00.000Z',
      to: '2026-01-01T07:00:00.000Z',
    })
    expect(r.success).toBe(true)
  })

  it('rejects to <= from', () => {
    const r = oeeQuerySchema.safeParse({
      workCenterId: VALID_WC,
      from: '2026-01-01T07:00:00.000Z',
      to: '2026-01-01T06:00:00.000Z',
    })
    expect(r.success).toBe(false)
  })
})
