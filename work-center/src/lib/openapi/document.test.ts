import { describe, expect, it } from 'vitest'
import { openApiDocument } from './document.js'

type Doc = {
  paths: Record<string, Record<string, { parameters?: { name: string }[] }>>
}

describe('work center service openapi document', () => {
  it('documents the work center reads', () => {
    expect(Object.keys((openApiDocument as Doc).paths)).toEqual(
      expect.arrayContaining(['/work-centers', '/work-centers/{id}']),
    )
  })

  it('documents the list filters', () => {
    const names = (openApiDocument as Doc).paths['/work-centers'].get.parameters?.map(p => p.name)
    expect(names).toEqual(expect.arrayContaining(['status', 'type', 'page', 'limit']))
  })
})
