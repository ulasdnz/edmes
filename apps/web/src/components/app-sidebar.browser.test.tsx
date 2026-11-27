import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { renderInApp } from '../test/render'
import { AppSidebar } from './app-sidebar'

const USER = 'sidebar-test-user'

function images(link: Element): HTMLImageElement[] {
  return [...link.querySelectorAll('img')]
}

async function loaded(image: HTMLImageElement) {
  await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true)
}

describe('AppSidebar brand', () => {
  beforeEach(() => localStorage.clear())
  afterEach(async () => {
    localStorage.clear()
    await page.viewport(414, 896)
  })

  // scenario: Web.brand / happy path / expanded sidebar: mark and wordmark as one link to /
  it('shows the mark and the EDMES wordmark as one link to / in the expanded sidebar', async () => {
    await page.viewport(1280, 900)
    const screen = await renderInApp(<AppSidebar userId={USER} />, { router: true })

    await expect.element(screen.getByRole('button', { name: 'Collapse menu' })).toBeVisible()
    const link = screen.getByRole('link', { name: 'EDMES' })
    await expect.element(link).toBeVisible()
    await expect.element(link).toHaveAttribute('href', '/')
    const [mark, wordmark, ...rest] = images(link.element())
    expect(rest).toEqual([])
    expect(mark?.getAttribute('alt')).toBe('')
    expect(wordmark?.getAttribute('alt')).toBe('EDMES')
    if (!mark || !wordmark) throw new Error('the brand link holds no images')
    await loaded(mark)
    await loaded(wordmark)
    // the mark is the square file, the wordmark the wide one
    expect(mark.naturalWidth).toBe(mark.naturalHeight)
    expect(wordmark.naturalWidth).toBeGreaterThan(wordmark.naturalHeight * 3)
  })

  // scenario: Web.brand / happy path / the rail shows the mark alone, a link to / named "EDMES"
  it('shows the mark alone in the rail, as a link to / named EDMES', async () => {
    await page.viewport(1000, 900)
    const screen = await renderInApp(<AppSidebar userId={USER} />, { router: true })

    await expect.element(screen.getByRole('button', { name: 'Expand menu' })).toBeVisible()
    const link = screen.getByRole('link', { name: 'EDMES' })
    await expect.element(link).toBeVisible()
    await expect.element(link).toHaveAttribute('href', '/')
    const all = images(link.element())
    expect(all).toHaveLength(1)
    const [mark] = all
    if (!mark) throw new Error('the rail link holds no image')
    expect(mark.getAttribute('alt')).toBe('')
    await loaded(mark)
    expect(mark.naturalWidth).toBe(mark.naturalHeight)
  })

  // scenario: Web.brand / constraints / files bundled with the app, no request leaves the origin
  it('loads both images from files bundled with the app, on its own origin', async () => {
    await page.viewport(1280, 900)
    const screen = await renderInApp(<AppSidebar userId={USER} />, { router: true })

    const link = screen.getByRole('link', { name: 'EDMES' })
    await expect.element(link).toBeVisible()
    const all = images(link.element())
    expect(all).toHaveLength(2)
    for (const image of all) {
      await loaded(image)
      const src = image.getAttribute('src') ?? ''
      expect(src).not.toMatch(/^[a-z][a-z0-9+.-]*:/i)
      expect(src.startsWith('//')).toBe(false)
      expect(new URL(image.src).origin).toBe(location.origin)
    }
    const elsewhere = performance
      .getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => new URL(name).origin !== location.origin)
    expect(elsewhere).toEqual([])
  })
})
