import { describe, expect, it } from 'vitest'
import { commonEn } from './common.en'
import { commonTr } from './common.tr'
import { createI18n } from './index'
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

describe('offline wording', () => {
  const english = createI18n({ language: 'en', resources: { en: commonEn, tr: commonTr } })
  const turkish = createI18n({ language: 'tr', resources: { en: commonEn, tr: commonTr } })

  // scenario: Web.offlineWording / happy path / English
  it('says "Offline since 10:31" in English', () => {
    expect(english.t('common.offlineSince', { time: '10:31' })).toBe('Offline since 10:31')
  })

  // scenario: Web.offlineWording / happy path / Turkish with a typographic apostrophe
  it('says "10:31’den beri çevrimdışı" in Turkish', () => {
    expect(turkish.t('common.offlineSince', { time: '10:31' })).toBe('10:31’den beri çevrimdışı')
  })

  // scenario: Web.offlineWording / boundaries / suffix follows the spoken last number of the time
  it.each([
    ['10:30', '10:30’dan'],
    ['10:40', '10:40’tan'],
    ['10:23', '10:23’ten'],
    ['10:36', '10:36’dan'],
    ['10:05', '10:05’ten'],
    ['10:09', '10:09’dan'],
    ['10:20', '10:20’den'],
    ['10:50', '10:50’den'],
    ['10:00', '10:00’dan'],
    ['09:00', '09:00’dan'],
    ['03:00', '03:00’ten'],
    ['00:00', '00:00’dan'],
  ])('gives %s the suffix of its spoken last number: %s', (time, expected) => {
    expect(turkish.t('common.offlineSince', { time })).toBe(`${expected} beri çevrimdışı`)
  })
})
