import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ConnectionIndicator } from './connection-indicator'

describe('ConnectionIndicator', () => {
  it('announces the connection state', async () => {
    const screen = await render(
      <ConnectionIndicator status='offline' label='Offline since 10:31' />,
    )
    await expect.element(screen.getByRole('status')).toHaveTextContent('Offline since 10:31')
  })
})
