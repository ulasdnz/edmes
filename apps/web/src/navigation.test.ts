import { describe, expect, it } from 'vitest'
import { navigation, visibleNavigation } from './navigation'

describe('visibleNavigation', () => {
  it('drops a group with no visible item', () => {
    expect(visibleNavigation(() => false)).toEqual([])
  })

  it('keeps the items the user may open', () => {
    expect(
      visibleNavigation(code => code === 'readUsers').flatMap(g => g.items.map(i => i.to)),
    ).toEqual(['/users'])
  })

  it('ships the system group with the users item', () => {
    expect(navigation.map(g => g.id)).toEqual(['system'])
  })
})
