import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
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
    ;(screen.getByRole('button').element() as HTMLButtonElement).focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onClick).not.toHaveBeenCalled()
  })

  // scenario: Ui.Button / happy path / <html data-density="touch">
  it('is 56 px tall when the page is in touch density', async () => {
    document.documentElement.dataset.density = 'touch'
    const screen = await render(<Button>Save</Button>)
    expect(screen.getByRole('button').element().getBoundingClientRect().height).toBe(56)
  })

  // scenario: Ui.Button / boundaries / size sm under data-density="touch"
  it('is 48 px tall small when the page is in touch density', async () => {
    document.documentElement.dataset.density = 'touch'
    const screen = await render(<Button size='sm'>Save</Button>)
    expect(screen.getByRole('button').element().getBoundingClientRect().height).toBe(48)
  })

  // scenario: Ui.Button / constraints / pending → disabled, aria-busy="true", spinner
  it('is disabled, busy and shows a spinner while pending', async () => {
    const screen = await render(
      <div>
        <Button pending>Save</Button>
        <Button>Cancel</Button>
      </div>,
    )
    const pending = screen.getByRole('button', { name: 'Save' })
    await expect.element(pending).toBeDisabled()
    await expect.element(pending).toHaveAttribute('aria-busy', 'true')
    const spinner = pending.element().querySelector('svg')
    expect(spinner).not.toBeNull()
    const box = spinner?.getBoundingClientRect()
    expect(box?.width).toBeGreaterThan(0)
    expect(box?.height).toBeGreaterThan(0)
    expect(spinner?.getAnimations().length).toBeGreaterThan(0)
    const idle = screen.getByRole('button', { name: 'Cancel' }).element()
    expect(idle.querySelector('svg')).toBeNull()
    expect(idle.hasAttribute('aria-busy')).toBe(false)
  })
})
