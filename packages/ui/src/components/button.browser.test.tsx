import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Button } from './button'

describe('Button', () => {
  it('is 36 px tall by default and 56 px in touch density', async () => {
    const screen = await render(<Button>Save</Button>)
    expect(screen.getByRole('button').element().getBoundingClientRect().height).toBe(36)
    document.documentElement.dataset.density = 'touch'
    expect(screen.getByRole('button').element().getBoundingClientRect().height).toBe(56)
  })

  it('is 28 px tall small and 48 px small in touch density', async () => {
    const screen = await render(<Button size='sm'>Save</Button>)
    expect(screen.getByRole('button').element().getBoundingClientRect().height).toBe(28)
    document.documentElement.dataset.density = 'touch'
    expect(screen.getByRole('button').element().getBoundingClientRect().height).toBe(48)
  })

  it('cannot be activated while pending', async () => {
    const onClick = vi.fn()
    const screen = await render(
      <Button pending onClick={onClick}>
        Save
      </Button>,
    )
    await expect.element(screen.getByRole('button')).toBeDisabled()
    await expect.element(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
    await screen.getByRole('button').click({ force: true })
    expect(onClick).not.toHaveBeenCalled()
  })
})
