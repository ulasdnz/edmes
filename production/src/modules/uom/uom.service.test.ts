import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { Product } from '../product/product.model.js'
import { Uom } from './uom.model.js'
import * as uomService from './uom.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitUomCreated: vi.fn(),
  emitUomUpdated: vi.fn(),
  emitUomDeleted: vi.fn(),
}))

const buildUom = (overrides: Record<string, unknown> = {}) => ({
  code: `UOM-${Date.now()}`,
  name: 'Kilogram',
  symbol: 'kg',
  ...overrides,
})

describe('UomService', () => {
  describe('create', () => {
    it('creates a uom with valid data', async () => {
      const doc = await uomService.create(buildUom())

      expect(doc._id).toBeDefined()
      expect(doc.code).toMatch(/^UOM-/)
      expect(doc.name).toBe('Kilogram')
      expect(doc.symbol).toBe('kg')
    })

    it('rejects duplicate code', async () => {
      const data = buildUom({ code: 'DUPE-UOM' })
      await uomService.create(data)

      await expect(uomService.create(data)).rejects.toThrow()
    })
  })

  describe('getById', () => {
    it('returns a uom by id', async () => {
      const created = await uomService.create(buildUom())
      const found = await uomService.getById(created._id.toString())

      expect(found.code).toBe(created.code)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(uomService.getById(fakeId)).rejects.toThrow('error.not_found')
    })
  })

  describe('list', () => {
    it('returns paginated results', async () => {
      await uomService.create(buildUom({ code: 'LIST-A', name: 'Alpha' }))
      await uomService.create(buildUom({ code: 'LIST-B', name: 'Beta' }))

      const result = await uomService.list({ page: 1, limit: 10 })

      expect(result.data.length).toBe(2)
      expect(result.pagination.total).toBe(2)
    })

    it('filters by code', async () => {
      await uomService.create(buildUom({ code: 'FILTER-X' }))
      await uomService.create(buildUom({ code: 'FILTER-Y' }))

      const result = await uomService.list({ page: 1, limit: 10, code: 'FILTER-X' })

      expect(result.data.length).toBe(1)
      expect(result.data[0].code).toBe('FILTER-X')
    })

    it('supports search across code, name, symbol', async () => {
      await uomService.create(buildUom({ code: 'SRCH-1', name: 'Meter', symbol: 'm' }))
      await uomService.create(buildUom({ code: 'SRCH-2', name: 'Liter', symbol: 'L' }))

      const result = await uomService.list({ page: 1, limit: 10, search: 'Meter' })

      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe('Meter')
    })

    it('sorts by code ascending', async () => {
      await uomService.create(buildUom({ code: 'SORT-B' }))
      await uomService.create(buildUom({ code: 'SORT-A' }))

      const result = await uomService.list({ page: 1, limit: 10, sort: 'code' })

      expect(result.data[0].code).toBe('SORT-A')
      expect(result.data[1].code).toBe('SORT-B')
    })
  })

  describe('update', () => {
    it('updates fields via patch', async () => {
      const created = await uomService.create(buildUom())
      const updated = await uomService.update(created._id.toString(), { name: 'Gram' })

      expect(updated.name).toBe('Gram')
      expect(updated.code).toBe(created.code)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(uomService.update(fakeId, { name: 'X' })).rejects.toThrow('error.not_found')
    })
  })

  describe('remove', () => {
    it('deletes when no references exist', async () => {
      const created = await uomService.create(buildUom())
      const deleted = await uomService.remove(created._id.toString())

      expect(deleted._id.toString()).toBe(created._id.toString())
      expect(await Uom.findById(created._id)).toBeNull()
    })

    it('blocks delete when Product references exist', async () => {
      const uom = await uomService.create(buildUom())
      await Product.create({
        code: 'PROD-REF',
        name: 'Test Product',
        kind: 'finished',
        uomId: uom._id,
      })

      await expect(uomService.remove(uom._id.toString())).rejects.toThrow('error.referenced')
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(uomService.remove(fakeId)).rejects.toThrow('error.not_found')
    })
  })
})
