import { describe, expect, it } from 'vitest'
import { safeRedirect } from './safe-redirect'

describe('safeRedirect', () => {
  it('keeps an address on this origin', () => {
    expect(safeRedirect('/users?page=2')).toBe('/users?page=2')
  })

  it('refuses another origin', () => {
    expect(safeRedirect('https://evil.example/')).toBe('/')
    expect(safeRedirect('//evil.example/')).toBe('/')
    expect(safeRedirect('/\\evil.example/')).toBe('/')
    expect(safeRedirect('javascript:alert(1)')).toBe('/')
  })

  it('falls back to the start page without a target', () => {
    expect(safeRedirect(undefined)).toBe('/')
    expect(safeRedirect('')).toBe('/')
    expect(safeRedirect(42)).toBe('/')
  })
})
