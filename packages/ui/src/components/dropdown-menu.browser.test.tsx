import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'

describe('DropdownMenu', () => {
  it('marks the keyboard-highlighted item with the accent background', async () => {
    const screen = await render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    await screen.getByRole('button', { name: 'Open' }).click()
    await expect.element(screen.getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{ArrowDown}')
    const item = document.querySelector('[data-slot="dropdown-menu-item"][data-highlighted]')
    expect(item).not.toBeNull()
    const popup = document.querySelector('[data-slot="dropdown-menu-content"]') as HTMLElement
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--color-accent-bg)'
    document.body.appendChild(probe)
    const accentBg = getComputedStyle(probe).backgroundColor
    probe.remove()
    const itemBg = getComputedStyle(item as Element).backgroundColor
    expect(itemBg).toBe(accentBg)
    expect(itemBg).not.toBe(getComputedStyle(popup).backgroundColor)
  })
})
