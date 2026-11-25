import { describe, expect, it } from 'vitest'
import { resolveLanguage } from './resolve-language'

describe('resolveLanguage', () => {
  it('prefers the language of the user', () => {
    expect(resolveLanguage({ user: 'tr', stored: 'en', browser: 'en-US' })).toBe('tr')
  })

  it('uses the stored choice before the browser', () => {
    expect(resolveLanguage({ stored: 'tr', browser: 'de-DE' })).toBe('tr')
  })

  it('uses a supported browser language', () => {
    expect(resolveLanguage({ browser: 'tr-TR' })).toBe('tr')
  })

  it('falls back to English', () => {
    expect(resolveLanguage({ browser: 'de-DE' })).toBe('en')
    expect(resolveLanguage({ user: 'fr', stored: null })).toBe('en')
  })
})
