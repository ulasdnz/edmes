import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductCategory } from '../product-category/product-category.model.js'
import { Uom } from '../uom/uom.model.js'
import { Product } from './product.model.js'
import * as productService from './product.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitProductCreated: vi.fn(),
  emitProductUpdated: vi.fn(),
  emitProductDeleted: vi.fn(),
}))

let defaultUomId: string

const createDefaultUom = async () => {
  const uom = await Uom.create({ code: `UOM-${Date.now()}`, name: 'Piece', symbol: 'pc' })
  defaultUomId = uom._id.toString()
  return defaultUomId
}

const buildProduct = (overrides: Record<string, unknown> = {}) => ({
  code: `PROD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name: 'Test Product',
  kind: 'finished' as const,
  uomId: defaultUomId,
  ...overrides,
})

describe('ProductService', () => {
  beforeEach(async () => {
    await createDefaultUom()
  })

  describe('create', () => {
    it('creates a product with valid data', async () => {
      const doc = await productService.create(buildProduct())

      expect(doc._id).toBeDefined()
      expect(doc.name).toBe('Test Product')
      expect(doc.kind).toBe('finished')
      expect(doc.uomId.toString()).toBe(defaultUomId)
    })

    it('creates with optional categoryId', async () => {
      const cat = await ProductCategory.create({ code: 'CAT-1', name: 'Category 1' })
      const doc = await productService.create(buildProduct({ categoryId: cat._id.toString() }))

      expect(doc.categoryId!.toString()).toBe(cat._id.toString())
    })

    it('creates with null description by default', async () => {
      const doc = await productService.create(buildProduct())
      expect(doc.description).toBeNull()
    })

    it('creates with props map', async () => {
      const doc = await productService.create(
        buildProduct({ props: { color: 'red', weight: '10kg' } }),
      )

      expect(doc.props).toBeDefined()
    })

    it('rejects duplicate code', async () => {
      const data = buildProduct({ code: 'DUPE-PROD' })
      await productService.create(data)

      await expect(productService.create(data)).rejects.toThrow()
    })

    it('rejects invalid uomId (not found)', async () => {
      const fakeUomId = new Types.ObjectId().toString()

      await expect(productService.create(buildProduct({ uomId: fakeUomId }))).rejects.toThrow(
        'error.not_found',
      )
    })

    it('rejects invalid categoryId (not found)', async () => {
      const fakeCatId = new Types.ObjectId().toString()

      await expect(productService.create(buildProduct({ categoryId: fakeCatId }))).rejects.toThrow(
        'error.not_found',
      )
    })
  })

  describe('getById', () => {
    it('returns a product by id', async () => {
      const created = await productService.create(buildProduct())
      const found = await productService.getById(created._id.toString())

      expect(found.code).toBe(created.code)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(productService.getById(fakeId)).rejects.toThrow('error.not_found')
    })
  })

  describe('list', () => {
    it('returns paginated results', async () => {
      await productService.create(buildProduct({ code: 'LP-1' }))
      await productService.create(buildProduct({ code: 'LP-2' }))

      const result = await productService.list({ page: 1, limit: 10 })

      expect(result.data.length).toBe(2)
      expect(result.pagination.total).toBe(2)
    })

    it('filters by kind', async () => {
      await productService.create(buildProduct({ code: 'FK-1', kind: 'finished' }))
      await productService.create(buildProduct({ code: 'FK-2', kind: 'semi_finished' }))

      const result = await productService.list({
        page: 1,
        limit: 10,
        kind: 'semi_finished',
      })

      expect(result.data.length).toBe(1)
      expect(result.data[0].kind).toBe('semi_finished')
    })

    it('supports search across code and name', async () => {
      await productService.create(buildProduct({ code: 'SP-1', name: 'Widget' }))
      await productService.create(buildProduct({ code: 'SP-2', name: 'Gadget' }))

      const result = await productService.list({ page: 1, limit: 10, search: 'Widget' })

      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe('Widget')
    })

    it('sorts by code ascending', async () => {
      await productService.create(buildProduct({ code: 'SORT-B' }))
      await productService.create(buildProduct({ code: 'SORT-A' }))

      const result = await productService.list({ page: 1, limit: 10, sort: 'code' })

      expect(result.data[0].code).toBe('SORT-A')
      expect(result.data[1].code).toBe('SORT-B')
    })
  })

  describe('update', () => {
    it('updates fields via patch', async () => {
      const created = await productService.create(buildProduct())
      const updated = await productService.update(created._id.toString(), { name: 'New Name' })

      expect(updated.name).toBe('New Name')
      expect(updated.code).toBe(created.code)
    })

    it('validates uomId on update', async () => {
      const created = await productService.create(buildProduct())
      const fakeUomId = new Types.ObjectId().toString()

      await expect(
        productService.update(created._id.toString(), { uomId: fakeUomId }),
      ).rejects.toThrow('error.not_found')
    })

    it('validates categoryId on update', async () => {
      const created = await productService.create(buildProduct())
      const fakeCatId = new Types.ObjectId().toString()

      await expect(
        productService.update(created._id.toString(), { categoryId: fakeCatId }),
      ).rejects.toThrow('error.not_found')
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(productService.update(fakeId, { name: 'X' })).rejects.toThrow('error.not_found')
    })
  })

  describe('remove', () => {
    it('deletes when no references exist', async () => {
      const created = await productService.create(buildProduct())
      const deleted = await productService.remove(created._id.toString())

      expect(deleted._id.toString()).toBe(created._id.toString())
      expect(await Product.findById(created._id)).toBeNull()
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(productService.remove(fakeId)).rejects.toThrow('error.not_found')
    })
  })
})
