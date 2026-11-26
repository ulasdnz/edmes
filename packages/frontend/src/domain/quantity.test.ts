import { expect, it } from 'vitest'
import { goodQuantity } from './quantity'

it('subtracts scrap and applies adjustments', () => {
  expect(goodQuantity({ gross: 1000, scrap: 40, adjustments: -10 })).toBe(950)
})
