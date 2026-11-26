import { describe, expect, it } from 'vitest'
import { openApiDocument } from './document.js'

type Doc = {
  paths: Record<string, Record<string, { parameters?: { name: string }[] }>>
}

describe('production service openapi document', () => {
  it('documents the job order reads and their filters', () => {
    const list = (openApiDocument as Doc).paths['/job-orders'].get
    const names = list.parameters?.map(p => p.name)
    expect(names).toEqual(
      expect.arrayContaining(['workCenterIds', 'runtimeState', 'page', 'limit']),
    )
    expect(Object.keys((openApiDocument as Doc).paths['/job-orders/{id}'])).toContain('get')
  })
})
