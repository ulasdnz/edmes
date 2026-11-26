import { ApiError } from '@mes/api-client'
import { describe, expect, it, vi } from 'vitest'
import { renderWithI18n } from '../../test/render'
import { LoginForm } from './login-form'

describe('LoginForm', () => {
  it('says the service is unavailable when the gateway finds user-service stopped', async () => {
    const onSubmit = vi.fn(() =>
      Promise.reject(
        new ApiError({
          kind: 'http',
          status: 503,
          code: 'gateway.unavailable',
          message: 'Service unavailable',
        }),
      ),
    )
    const screen = await renderWithI18n(<LoginForm onSubmit={onSubmit} />)
    await screen.getByLabelText('Email').fill('ada@example.com')
    await screen.getByLabelText('Password').fill('secret')
    await screen.getByRole('button', { name: 'Sign in' }).click()
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('The service is unavailable. Try again in a moment.')
  })
})
