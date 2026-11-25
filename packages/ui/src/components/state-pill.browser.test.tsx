import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { StatePill } from './state-pill'

describe('StatePill', () => {
  it('gives every state its own shape, so color is never the only signal', async () => {
    const screen = await render(
      <div>
        <StatePill state='running'>Running</StatePill>
        <StatePill state='unplanned'>Unplanned stop</StatePill>
        <StatePill state='planned'>Planned stop</StatePill>
        <StatePill state='idle'>Idle</StatePill>
      </div>,
    )
    const shapes = Array.from(screen.container.querySelectorAll('[data-shape]'), el =>
      el.getAttribute('data-shape'),
    )
    expect(shapes).toEqual(['play', 'octagon', 'pause', 'ring'])
  })
})
