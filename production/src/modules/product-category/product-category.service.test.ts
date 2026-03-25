import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { Product } from '../product/product.model.js'
import { ProductCategory } from './product-category.model.js'
import * as categoryService from './product-category.service.js'

vi.mock('../../jobs/events.js', () => ({
  emitProductCategoryCreated: vi.fn(),
  emitProductCategoryUpdated: vi.fn(),
  emitProductCategoryDeleted: vi.fn(),
}))

const buildCategory = (overrides: Record<string, unknown> = {}) => ({
  code: `CAT-${Date.now()}`,
  name: 'Raw Materials',
  ...overrides,
})

describe('ProductCategoryService', () => {
  describe('create', () => {
    it('creates a category with valid data', async () => {
      const doc = await categoryService.create(buildCategory())

      expect(doc._id).toBeDefined()
      expect(doc.name).toBe('Raw Materials')
    })

    it('creates with null description by default', async () => {
      const doc = await categoryService.create(buildCategory())

      expect(doc.description).toBeNull()
    })

    it('creates with explicit description', async () => {
      const doc = await categoryService.create(buildCategory({ description: 'Test description' }))

      expect(doc.description).toBe('Test description')
    })

    it('rejects duplicate code', async () => {
      const data = buildCategory({ code: 'DUPE-CAT' })
      await categoryService.create(data)

      await expect(categoryService.create(data)).rejects.toThrow()
    })
  })

  describe('getById', () => {
    it('returns a category by id', async () => {
      const created = await categoryService.create(buildCategory())
      const found = await categoryService.getById(created._id.toString())

      expect(found.code).toBe(created.code)
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(categoryService.getById(fakeId)).rejects.toThrow('error.not_found')
    })
  })

  describe('list', () => {
    it('returns paginated results', async () => {
      await categoryService.create(buildCategory({ code: 'LIST-C1' }))
      await categoryService.create(buildCategory({ code: 'LIST-C2' }))

      const result = await categoryService.list({ page: 1, limit: 10 })

      expect(result.data.length).toBe(2)
      expect(result.pagination.total).toBe(2)
    })

    it('filters by code', async () => {
      await categoryService.create(buildCategory({ code: 'FILT-A' }))
      await categoryService.create(buildCategory({ code: 'FILT-B' }))

      const result = await categoryService.list({ page: 1, limit: 10, code: 'FILT-A' })

      expect(result.data.length).toBe(1)
      expect(result.data[0].code).toBe('FILT-A')
    })

    it('supports search across code and name', async () => {
      await categoryService.create(buildCategory({ code: 'S-1', name: 'Electronics' }))
      await categoryService.create(buildCategory({ code: 'S-2', name: 'Plastics' }))

      const result = await categoryService.list({ page: 1, limit: 10, search: 'Electro' })

      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe('Electronics')
    })

    it('sorts by name ascending', async () => {
      await categoryService.create(buildCategory({ code: 'SO-1', name: 'Zeta' }))
      await categoryService.create(buildCategory({ code: 'SO-2', name: 'Alpha' }))

      const result = await categoryService.list({ page: 1, limit: 10, sort: 'name' })

      expect(result.data[0].name).toBe('Alpha')
      expect(result.data[1].name).toBe('Zeta')
    })
  })

  describe('update', () => {
    it('updates fields via patch', async () => {
      const created = await categoryService.create(buildCategory())
      const updated = await categoryService.update(created._id.toString(), {
        name: 'Updated Name',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.code).toBe(created.code)
    })

    it('updates description to null', async () => {
      const created = await categoryService.create(buildCategory({ description: 'Some desc' }))
      const updated = await categoryService.update(created._id.toString(), {
        description: null,
      })

      expect(updated.description).toBeNull()
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(categoryService.update(fakeId, { name: 'X' })).rejects.toThrow('error.not_found')
    })
  })

  describe('remove', () => {
    it('deletes when no references exist', async () => {
      const created = await categoryService.create(buildCategory())
      const deleted = await categoryService.remove(created._id.toString())

      expect(deleted._id.toString()).toBe(created._id.toString())
      expect(await ProductCategory.findById(created._id)).toBeNull()
    })

    it('blocks delete when Product references exist', async () => {
      const cat = await categoryService.create(buildCategory())
      const uom = await (await import('../uom/uom.model.js')).Uom.create({
        code: 'UOM-REF',
        name: 'Piece',
        symbol: 'pc',
      })
      await Product.create({
        code: 'PROD-CAT-REF',
        name: 'Test Product',
        kind: 'finished',
        uomId: uom._id,
        categoryId: cat._id,
      })

      await expect(categoryService.remove(cat._id.toString())).rejects.toThrow('error.referenced')
    })

    it('throws 404 for non-existent id', async () => {
      const fakeId = new Types.ObjectId().toString()
      await expect(categoryService.remove(fakeId)).rejects.toThrow('error.not_found')
    })
  })
})
