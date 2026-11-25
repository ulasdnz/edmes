import { describe, expect, it } from 'vitest'
import { formatInstant, isUtcInstant, plantLocalToInstant } from './format'

describe('isUtcInstant', () => {
  it('accepts only ISO 8601 with a trailing Z', () => {
    expect(isUtcInstant('2026-04-04T12:30:00.000Z')).toBe(true)
    expect(isUtcInstant('2026-04-04T12:30:00')).toBe(false)
    expect(isUtcInstant('2026-04-04 12:30:00')).toBe(false)
    expect(isUtcInstant('2026-04-04T12:30:00+03:00')).toBe(false)
    expect(isUtcInstant('2026-13-04T12:30:00.000Z')).toBe(false)
  })
})

describe('formatInstant', () => {
  it('formats in the given time zone, not the machine one', () => {
    expect(
      formatInstant('2026-04-04T12:30:00.000Z', {
        timeZone: 'Europe/Istanbul',
        locale: 'tr',
        style: 'time',
      }),
    ).toBe('15:30')
  })
})

describe('plantLocalToInstant', () => {
  it('converts plant local time to a UTC instant', () => {
    expect(plantLocalToInstant('2026-04-04T15:30', 'Europe/Istanbul')).toBe(
      '2026-04-04T12:30:00.000Z',
    )
  })

  it('resolves a local time that does not exist forward', () => {
    expect(plantLocalToInstant('2026-03-29T02:30', 'Europe/Berlin')).toBe(
      '2026-03-29T01:30:00.000Z',
    )
  })

  it('resolves a local time that happens twice to the first occurrence', () => {
    expect(plantLocalToInstant('2026-10-25T02:30', 'Europe/Berlin')).toBe(
      '2026-10-25T00:30:00.000Z',
    )
  })
})
