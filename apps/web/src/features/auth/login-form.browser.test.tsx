import { ApiError } from '@mes/api-client'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderWithI18n } from '../../test/render'
import { LoginForm } from './login-form'

async function fillIn(screen: Awaited<ReturnType<typeof renderWithI18n>>) {
  await screen.getByLabelText('Email').fill('ada@example.com')
  await screen.getByLabelText('Password', { exact: true }).fill('secret')
}

describe('LoginForm', () => {
  it('shows the lockout message of the server', async () => {
    const message = 'Account is temporarily locked. Try again in 300 seconds.'
    const onSubmit = vi.fn(() =>
      Promise.reject(
        new ApiError({
          kind: 'http',
          status: 423,
          code: 'auth.account_temporarily_locked',
          message,
        }),
      ),
    )
    const screen = await renderWithI18n(<LoginForm onSubmit={onSubmit} />)
    await fillIn(screen)
    await screen.getByRole('button', { name: 'Sign in' }).click()
    await expect.element(screen.getByRole('alert')).toHaveTextContent(message)
  })

  // The design's live countdown ("Try again in 4:32") and "2 attempts left" need numbers the API
  // does not return: remainingSeconds exists only inside the translated message. They wait for
  // backend change B10.
  it('shows the message of the server and lets the user try again', async () => {
    const onSubmit = vi.fn(() =>
      Promise.reject(
        new ApiError({
          kind: 'http',
          status: 401,
          code: 'auth.invalid_credentials',
          message: 'Invalid email or password',
        }),
      ),
    )
    const screen = await renderWithI18n(<LoginForm onSubmit={onSubmit} />)
    await fillIn(screen)
    await screen.getByRole('button', { name: 'Sign in' }).click()
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Invalid email or password')
    await expect.element(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('explains a server that cannot be reached', async () => {
    const onSubmit = vi.fn(() =>
      Promise.reject(new ApiError({ kind: 'network', code: 'client.network' })),
    )
    const screen = await renderWithI18n(<LoginForm onSubmit={onSubmit} />)
    await fillIn(screen)
    await screen.getByRole('button', { name: 'Sign in' }).click()
    await expect
      .element(screen.getByRole('alert'))
      .toMatchTextContent(/The server could not be reached/)
  })

  it('submits once while the request is pending', async () => {
    let finish: () => void = () => {}
    const onSubmit = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    const screen = await renderWithI18n(<LoginForm onSubmit={onSubmit} />)
    await fillIn(screen)
    const button = screen.getByRole('button', { name: 'Sign in' })
    await userEvent.dblClick(button)
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'secret' })
    finish()
  })
})
