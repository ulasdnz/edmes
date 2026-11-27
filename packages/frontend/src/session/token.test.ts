import { describe, expect, it } from 'vitest'
import { tokenIssuedAt } from './token'

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (payload: object) =>
  `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`

describe('tokenIssuedAt', () => {
  it('reads the issue time of a JWT as a date', () => {
    expect(tokenIssuedAt(jwt({ id: 'u1', iat: 1795680000 }))?.toISOString()).toBe(
      '2026-11-26T08:00:00.000Z',
    )
  })

  it('reads a payload whose base64url text holds - and _', () => {
    const token = jwt({ id: '>>>???', iat: 1795680000 })
    expect(token.split('.')[1]).toMatch(/[-_]/)
    expect(tokenIssuedAt(token)?.getTime()).toBe(1795680000 * 1000)
  })

  it('answers null for no token, a malformed one, or one without iat', () => {
    expect(tokenIssuedAt(null)).toBeNull()
    expect(tokenIssuedAt('not-a-token')).toBeNull()
    expect(tokenIssuedAt('a.%%%.c')).toBeNull()
    expect(tokenIssuedAt(jwt({ id: 'u1' }))).toBeNull()
    expect(tokenIssuedAt(jwt({ iat: 'yesterday' }))).toBeNull()
  })
})

it('gives null for an issue time no date can hold, so the page does not throw', () => {
  const payload = btoa(JSON.stringify({ iat: 1e20 }))
  expect(tokenIssuedAt(`header.${payload}.signature`)).toBeNull()
})
