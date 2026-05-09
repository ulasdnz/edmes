import { describe, expect, it } from 'vitest'
import { stateDurationsQuerySchema } from './historian.validators.js'

const validQuery = {
  from: '2026-04-01T10:00:00.000Z',
  to: '2026-04-01T11:00:00.000Z',
}

describe('stateDurationsQuerySchema', () => {
  it('defaults limit to 500 and keeps after optional', () => {
    const parsed = stateDurationsQuerySchema.parse(validQuery)

    expect(parsed.from).toEqual(new Date(validQuery.from))
    expect(parsed.to).toEqual(new Date(validQuery.to))
    expect(parsed.limit).toBe(500)
    expect(parsed.after).toBeUndefined()
  })

  it('rejects limit=1 because after-inclusive pagination would stall', () => {
    const result = stateDurationsQuerySchema.safeParse({
      ...validQuery,
      limit: '1',
    })

    expect(result.success).toBe(false)
  })

  it('parses after as an optional UTC Date cursor', () => {
    const after = '2026-04-01T10:30:00.000Z'

    const parsed = stateDurationsQuerySchema.parse({
      ...validQuery,
      limit: '2',
      after,
    })

    expect(parsed.limit).toBe(2)
    expect(parsed.after).toEqual(new Date(after))
  })
})
