import { describe, expect, it } from 'vitest'
import { codeSchema } from './code.js'

describe('codeSchema', () => {
  it('keeps one spelling of a code: trimmed and in upper case', () => {
    expect(codeSchema.parse('  jo-2025/01_a.b ')).toBe('JO-2025/01_A.B')
    expect(codeSchema.parse('kalıp-01')).toBe('KALIP-01')
  })

  it('rejects characters a barcode cannot carry, Turkish letters included', () => {
    for (const code of ['ŞASİ-1', 'çelik', 'JO 1', 'JO#1']) {
      expect(codeSchema.safeParse(code).error?.issues[0].message, code).toBe('error.invalid_code')
    }
  })

  it('rejects an empty code', () => {
    expect(codeSchema.safeParse('   ').success).toBe(false)
  })
})
